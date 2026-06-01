// Anti-cheat orchestration: when a flag-supplier match is detected, this
// helper performs the transactional state changes:
//   - log the wrong attempt (the consumer's submission)
//   - increment supplier strike counter, snapshot to a queue row
//   - freeze the consumer immediately (cheat_consumer)
//   - if supplier hit strike 2, freeze the supplier (cheat_supplier_strike2)
//   - emit a `cheat_detected` event for the admin live feed
//
// The supplier's first-login experience reads unack'd `cheat_strikes` rows.
// On strike 1 they see a one-shot `/strike-notice` redirect (the user-designed
// experience). On strike 2 they're already frozen, so the `/strike-notice`
// ack just hands them off to `/frozen`.

import { db } from '../db/index.js';

const insertAttempt = db.prepare(`
  INSERT INTO attempts (user_id, challenge_id, submitted, correct, ip, user_agent)
  VALUES (?, ?, ?, 0, ?, ?)
`);
const bumpStrikes = db.prepare(`
  UPDATE users SET cheat_strikes = cheat_strikes + 1 WHERE id = ?
`);
const readStrikes = db.prepare(`SELECT cheat_strikes, alias FROM users WHERE id = ?`);
const insertStrikeRow = db.prepare(`
  INSERT INTO cheat_strikes (supplier_id, consumer_id, challenge_id, strike_number, submitted_flag, consumer_ip, consumer_ua)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const freezeUser = db.prepare(`
  UPDATE users SET frozen_at = datetime('now'), frozen_reason = ? WHERE id = ? AND frozen_at IS NULL
`);
const insertEvent = db.prepare(`
  INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)
`);
const consumerAlias = db.prepare(`SELECT alias FROM users WHERE id = ?`);

export interface CheatDetectionInput {
  consumerId: number;
  supplierId: number;
  challengeId: string;
  submitted: string;
  ip: string | null;
  ua: string | null;
}

export interface CheatDetectionResult {
  strikeNumber: number;
  supplierFrozen: boolean;
}

export function recordCheatDetection(input: CheatDetectionInput): CheatDetectionResult {
  const tx = db.transaction(() => {
    insertAttempt.run(input.consumerId, input.challengeId, input.submitted, input.ip, input.ua);

    bumpStrikes.run(input.supplierId);
    const supplier = readStrikes.get(input.supplierId) as { cheat_strikes: number; alias: string };
    const strikeNumber = supplier.cheat_strikes;

    insertStrikeRow.run(
      input.supplierId,
      input.consumerId,
      input.challengeId,
      strikeNumber,
      input.submitted,
      input.ip,
      input.ua,
    );

    // Consumer always freezes immediately on first detection.
    freezeUser.run('cheat_consumer', input.consumerId);

    let supplierFrozen = false;
    if (strikeNumber >= 2) {
      freezeUser.run('cheat_supplier_strike2', input.supplierId);
      supplierFrozen = true;
    }

    const consumer = consumerAlias.get(input.consumerId) as { alias: string };
    insertEvent.run(
      'cheat_detected',
      input.consumerId,
      JSON.stringify({
        challenge_id: input.challengeId,
        consumer_id: input.consumerId,
        consumer_alias: consumer.alias,
        supplier_id: input.supplierId,
        supplier_alias: supplier.alias,
        strike_number: strikeNumber,
        supplier_frozen: supplierFrozen,
      }),
    );

    return { strikeNumber, supplierFrozen };
  });
  return tx();
}

const unackStrikes = db.prepare(`
  SELECT id, supplier_id, consumer_id, challenge_id, detected_at, strike_number
  FROM cheat_strikes
  WHERE supplier_id = ? AND acknowledged_at IS NULL
  ORDER BY id ASC
`);
const ackAllForSupplier = db.prepare(`
  UPDATE cheat_strikes SET acknowledged_at = datetime('now')
  WHERE supplier_id = ? AND acknowledged_at IS NULL
`);
const allStrikesForSupplier = db.prepare(`
  SELECT id, consumer_id, challenge_id, detected_at, acknowledged_at, strike_number
  FROM cheat_strikes WHERE supplier_id = ? ORDER BY id DESC
`);

export interface StrikeRow {
  id: number;
  supplier_id?: number;
  consumer_id: number;
  challenge_id: string;
  detected_at: string;
  acknowledged_at?: string | null;
  strike_number: number;
}

export function unacknowledgedStrikes(supplierId: number): StrikeRow[] {
  return unackStrikes.all(supplierId) as StrikeRow[];
}

export function acknowledgeStrikes(supplierId: number): number {
  const r = ackAllForSupplier.run(supplierId);
  return Number(r.changes);
}

export function listStrikesForSupplier(supplierId: number): StrikeRow[] {
  return allStrikesForSupplier.all(supplierId) as StrikeRow[];
}

const unfreezeUser = db.prepare(`
  UPDATE users SET frozen_at = NULL, frozen_reason = NULL WHERE id = ?
`);
const clearStrikes = db.prepare(`
  UPDATE users SET cheat_strikes = 0 WHERE id = ?
`);

export function adminUnfreeze(userId: number): boolean {
  const r = unfreezeUser.run(userId);
  return r.changes > 0;
}

export function adminClearStrikes(userId: number): { strikesCleared: number; rowsAcked: number } {
  const tx = db.transaction(() => {
    const before = (db.prepare(`SELECT cheat_strikes FROM users WHERE id = ?`).get(userId) as { cheat_strikes: number } | undefined)?.cheat_strikes ?? 0;
    clearStrikes.run(userId);
    const r = ackAllForSupplier.run(userId);
    return { strikesCleared: before, rowsAcked: Number(r.changes) };
  });
  return tx();
}

// Dossier for the supplier's strike-notice page. Aggregates everything the
// "we have noticed" view shows: incident count, list of leaked flags, list of
// downstream consumer aliases, first/last seen.
const supplierDossierStmt = db.prepare(`
  SELECT cs.detected_at, cs.submitted_flag, cs.challenge_id, cs.strike_number,
         u.alias AS consumer_alias
  FROM cheat_strikes cs
  LEFT JOIN users u ON u.id = cs.consumer_id
  WHERE cs.supplier_id = ?
  ORDER BY cs.id ASC
`);

export interface SupplierDossier {
  incidents: number;
  flagsLeaked: string[];
  consumers: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export function supplierDossier(supplierId: number): SupplierDossier {
  const rows = supplierDossierStmt.all(supplierId) as Array<{
    detected_at: string;
    submitted_flag: string | null;
    challenge_id: string;
    strike_number: number;
    consumer_alias: string | null;
  }>;
  const flags = new Set<string>();
  const consumers = new Set<string>();
  for (const r of rows) {
    if (r.submitted_flag) flags.add(r.submitted_flag);
    if (r.consumer_alias) consumers.add(r.consumer_alias);
  }
  return {
    incidents: rows.length,
    flagsLeaked: Array.from(flags),
    consumers: Array.from(consumers),
    firstSeen: rows[0]?.detected_at ?? null,
    lastSeen: rows[rows.length - 1]?.detected_at ?? null,
  };
}

// Evidence for the consumer's /frozen page. Pulls the most recent strike
// where this user was the consumer (the one that froze them).
const consumerEvidenceStmt = db.prepare(`
  SELECT cs.detected_at, cs.submitted_flag, cs.challenge_id, cs.strike_number,
         cs.consumer_ip, cs.consumer_ua, u.alias AS supplier_alias,
         c.ordinal AS challenge_ordinal, c.title AS challenge_title
  FROM cheat_strikes cs
  LEFT JOIN users u ON u.id = cs.supplier_id
  LEFT JOIN challenges c ON c.id = cs.challenge_id
  WHERE cs.consumer_id = ?
  ORDER BY cs.id DESC
  LIMIT 1
`);

export interface ConsumerEvidence {
  detectedAt: string;
  submittedFlag: string | null;
  challengeId: string;
  challengeOrdinal: number | null;
  challengeTitle: string | null;
  strikeNumber: number;
  consumerIp: string | null;
  consumerUa: string | null;
  supplierAlias: string | null;
}

export function consumerEvidence(consumerId: number): ConsumerEvidence | null {
  const r = consumerEvidenceStmt.get(consumerId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    detectedAt: String(r.detected_at),
    submittedFlag: (r.submitted_flag as string | null) ?? null,
    challengeId: String(r.challenge_id),
    challengeOrdinal: (r.challenge_ordinal as number | null) ?? null,
    challengeTitle: (r.challenge_title as string | null) ?? null,
    strikeNumber: Number(r.strike_number ?? 0),
    consumerIp: (r.consumer_ip as string | null) ?? null,
    consumerUa: (r.consumer_ua as string | null) ?? null,
    supplierAlias: (r.supplier_alias as string | null) ?? null,
  };
}
