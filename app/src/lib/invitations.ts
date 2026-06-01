// Operator-issued invitations.
//
// A signed-in operator can hand out N invitation slots (default 2, see
// app_settings.invitations_per_operator). A pending or accepted invite
// occupies a slot; revoke + expiry free it. Admin overrides + admin-grants
// (from invite_requests approval) bypass the quota.
//
// Token shape mirrors magic_links: 48-hex from randomBytes(24). The flavour
// "ed25519" string in placeholder copy stays — it's not an actual signature
// algorithm here, just narrative.

import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import * as settings from './settings.js';
import { findOrCreateUser, getUserByEmail, type User } from './playerAuth.js';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type InvitationSource = 'operator' | 'admin_override' | 'admin_grant';

export interface Invitation {
  id: number;
  token: string;
  inviter_id: number | null;
  invitee_email: string;
  note: string | null;
  status: InvitationStatus;
  source: InvitationSource;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_user_id: number | null;
  revoked_at: string | null;
  revoked_by: string | null;
  inviter_alias_override: string | null;
}

export interface QuotaState {
  used: number;
  limit: number;
  available: number;
}

const DEFAULT_LIMIT = 2;
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000;

const selectByToken = db.prepare(`SELECT * FROM invitations WHERE token = ?`);
const selectById = db.prepare(`SELECT * FROM invitations WHERE id = ?`);

const insertInvitation = db.prepare(`
  INSERT INTO invitations (token, inviter_id, invitee_email, note, status, source, expires_at, inviter_alias_override)
  VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
`);

const markAcceptedStmt = db.prepare(`
  UPDATE invitations
  SET status = 'accepted', claimed_at = datetime('now'), claimed_user_id = ?
  WHERE id = ? AND status = 'pending'
`);

const markRevokedStmt = db.prepare(`
  UPDATE invitations
  SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?
  WHERE id = ? AND status = 'pending'
`);

// Note: `expires_at` is stored as JS toISOString() (e.g. 2026-04-30T13:00:00.000Z)
// while datetime('now') returns SQLite's space-separated format
// (2026-04-30 13:00:00). A naïve string comparison sorts wrong because 'T' > ' '
// in ASCII, so we always wrap stored timestamps with datetime(...) to normalize
// both sides before comparing.

const selectExpirable = db.prepare(`
  SELECT id, inviter_id FROM invitations
  WHERE status = 'pending' AND datetime(expires_at) <= datetime('now')
`);

const markExpiredStmt = db.prepare(`
  UPDATE invitations SET status = 'expired'
  WHERE status = 'pending' AND datetime(expires_at) <= datetime('now')
`);

const insertEvent = db.prepare(`
  INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)
`);

// Quota: counts pending+accepted, but a pending row past its TTL doesn't
// count (the periodic sweepExpired() may not have run yet on this read).
const countActiveSlotsStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM invitations
  WHERE inviter_id = ?
    AND status IN ('pending','accepted')
    AND (status != 'pending' OR datetime(expires_at) > datetime('now'))
`);

const selectInviterPool = db.prepare(`
  SELECT * FROM invitations
  WHERE inviter_id = ?
  ORDER BY created_at DESC
`);

const selectAllJoined = db.prepare(`
  SELECT i.*, COALESCE(i.inviter_alias_override, u.alias) AS inviter_alias
  FROM invitations i
  LEFT JOIN users u ON u.id = i.inviter_id
  ORDER BY i.created_at DESC
`);

const selectDuplicatePending = db.prepare(`
  SELECT id FROM invitations
  WHERE inviter_id = ? AND lower(invitee_email) = lower(?)
    AND status = 'pending' AND datetime(expires_at) > datetime('now')
  LIMIT 1
`);

// ── Setting parsers ────────────────────────────────────────────────────

export function getLimit(): number {
  const raw = settings.get('invitations_per_operator');
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

// Parse Nh|Nm|Nd into milliseconds. Falls back to 72h on bad input.
export function parseDuration(s: string | null | undefined): number {
  if (!s) return DEFAULT_TTL_MS;
  const m = String(s).trim().match(/^(\d+)\s*([hmd])$/i);
  if (!m) return DEFAULT_TTL_MS;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MS;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  return DEFAULT_TTL_MS;
}

export function getTtlMs(): number {
  return parseDuration(settings.get('invite_token_ttl'));
}

// Pretty label like "72h" or "3d", for use in the email template.
export function expiresInLabel(): string {
  const raw = settings.get('invite_token_ttl');
  return raw && raw.trim() ? raw.trim() : '72h';
}

// ── Sweep + quota ──────────────────────────────────────────────────────

// Flip pending-past-TTL rows to expired and emit an invite_expired event for
// each. Runs in a single transaction. Returns count.
export function sweepExpired(): number {
  let n = 0;
  const tx = db.transaction(() => {
    const rows = selectExpirable.all() as { id: number; inviter_id: number }[];
    if (!rows.length) return;
    markExpiredStmt.run();
    for (const r of rows) {
      insertEvent.run('invite_expired', r.inviter_id, JSON.stringify({ invitation_id: r.id }));
    }
    n = rows.length;
  });
  tx();
  return n;
}

export function quotaFor(inviterId: number): QuotaState {
  sweepExpired();
  const limit = getLimit();
  const r = countActiveSlotsStmt.get(inviterId) as { n: number };
  const used = r.n;
  return { used, limit, available: Math.max(0, limit - used) };
}

// ── Reads ──────────────────────────────────────────────────────────────

export function findByToken(token: string): Invitation | null {
  return (selectByToken.get(token) as Invitation | undefined) ?? null;
}

export function findById(id: number): Invitation | null {
  return (selectById.get(id) as Invitation | undefined) ?? null;
}

export function listForInviter(inviterId: number): Invitation[] {
  return selectInviterPool.all(inviterId) as Invitation[];
}

export function listAll(): (Invitation & { inviter_alias: string })[] {
  return selectAllJoined.all() as (Invitation & { inviter_alias: string })[];
}

// ── Writes ─────────────────────────────────────────────────────────────

export class InvitationError extends Error {
  code: 'quota' | 'duplicate_email' | 'self_invite' | 'already_user' | 'invalid_email' | 'unknown_inviter' | 'inviter_required';
  constructor(code: InvitationError['code'], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface CreateInvitationArgs {
  // null = unattributed admin_override (admin types a custom alias instead of
  // picking an existing operator). Required for everything else.
  inviterId: number | null;
  inviteeEmail: string;
  note: string | null;
  source?: InvitationSource;
  bypassQuota?: boolean;
  // admin_override only: free-text alias displayed in claim email/page when
  // inviterId is null, or as a costume on top of an existing operator.
  inviterAliasOverride?: string | null;
}

export function createInvitation(args: CreateInvitationArgs): Invitation {
  const email = (args.inviteeEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new InvitationError('invalid_email');

  const note = args.note?.trim() ? args.note.trim().slice(0, 240) : null;
  const source: InvitationSource = args.source ?? 'operator';
  const bypassQuota = !!args.bypassQuota;
  const aliasOverride = args.inviterAliasOverride?.trim()
    ? args.inviterAliasOverride.trim().slice(0, 40)
    : null;

  // A null inviter is only legal for admin_override + when a custom alias is
  // supplied — every other path needs an attributed operator.
  if (args.inviterId == null && (source !== 'admin_override' || !aliasOverride)) {
    throw new InvitationError('inviter_required');
  }

  let result!: Invitation;
  const tx = db.transaction(() => {
    // 1. Sweep first so quota math + duplicate-pending check both use a
    //    consistent view of which rows still occupy slots.
    const rows = selectExpirable.all() as { id: number; inviter_id: number | null }[];
    if (rows.length) {
      markExpiredStmt.run();
      for (const r of rows) {
        insertEvent.run('invite_expired', r.inviter_id, JSON.stringify({ invitation_id: r.id }));
      }
    }

    // 2. When an inviter is named, validate it exists (otherwise the FK on
    //    invitations.inviter_id surfaces as SQLITE_CONSTRAINT_FOREIGNKEY → 500).
    if (args.inviterId != null) {
      const inviter = db.prepare(`SELECT email FROM users WHERE id = ?`).get(args.inviterId) as { email: string } | undefined;
      if (!inviter) throw new InvitationError('unknown_inviter');
      if (inviter.email.toLowerCase() === email) {
        throw new InvitationError('self_invite');
      }
    }

    // 3. Already-a-user guard.
    const existing = getUserByEmail(email);
    if (existing) throw new InvitationError('already_user');

    // 4. Duplicate pending — only meaningful when an inviter is attributed.
    if (args.inviterId != null) {
      const dup = selectDuplicatePending.get(args.inviterId, email) as { id: number } | undefined;
      if (dup) throw new InvitationError('duplicate_email');
    }

    // 5. Quota.
    if (!bypassQuota && args.inviterId != null) {
      const limit = getLimit();
      const used = (countActiveSlotsStmt.get(args.inviterId) as { n: number }).n;
      if (used >= limit) throw new InvitationError('quota');
    }

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + getTtlMs()).toISOString();
    const r = insertInvitation.run(token, args.inviterId, email, note, source, expiresAt, aliasOverride);
    result = selectById.get(r.lastInsertRowid) as Invitation;
  });
  tx();
  return result;
}

// Single source of truth for "what name should we show as the inviter?".
// Admin override + custom alias wins; otherwise the looked-up operator alias;
// otherwise a generic fallback.
export function inviterDisplayAlias(
  inv: Pick<Invitation, 'inviter_id' | 'inviter_alias_override'>,
  fallback = 'an operator',
): string {
  if (inv.inviter_alias_override) return inv.inviter_alias_override;
  if (inv.inviter_id != null) {
    const row = db.prepare(`SELECT alias FROM users WHERE id = ?`).get(inv.inviter_id) as { alias: string } | undefined;
    if (row?.alias) return row.alias;
  }
  return fallback;
}

export type ClaimResult =
  | { ok: true; invitation: Invitation; user: User }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_used' | 'revoked' | 'alias_taken' };

export interface ClaimInvitationArgs {
  token: string;
  alias: string;
}

export function claimInvitation(args: ClaimInvitationArgs): ClaimResult {
  let outcome: ClaimResult | null = null;
  const tx = db.transaction(() => {
    // Sweep first so an expired row is reported as 'expired' not 'pending'.
    const rows = selectExpirable.all() as { id: number; inviter_id: number }[];
    if (rows.length) {
      markExpiredStmt.run();
      for (const r of rows) {
        insertEvent.run('invite_expired', r.inviter_id, JSON.stringify({ invitation_id: r.id }));
      }
    }

    const row = selectByToken.get(args.token) as Invitation | undefined;
    if (!row) { outcome = { ok: false, reason: 'not_found' }; return; }
    if (row.status === 'accepted') { outcome = { ok: false, reason: 'already_used' }; return; }
    if (row.status === 'revoked') { outcome = { ok: false, reason: 'revoked' }; return; }
    if (row.status === 'expired') { outcome = { ok: false, reason: 'expired' }; return; }

    let user: User;
    try {
      user = findOrCreateUser(row.invitee_email, args.alias);
    } catch (e) {
      // SQLITE_CONSTRAINT on users.alias UNIQUE → alias_taken.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('UNIQUE') && msg.toLowerCase().includes('alias')) {
        outcome = { ok: false, reason: 'alias_taken' };
        return;
      }
      throw e;
    }

    const r = markAcceptedStmt.run(user.id, row.id);
    if (r.changes === 0) {
      // Concurrent race — another claimer flipped the row.
      outcome = { ok: false, reason: 'already_used' };
      return;
    }
    const fresh = selectById.get(row.id) as Invitation;
    outcome = { ok: true, invitation: fresh, user };
  });
  tx();
  return outcome!;
}

export function revokeInvitation(id: number, revokedBy: string): boolean {
  let ok = false;
  const tx = db.transaction(() => {
    const row = selectById.get(id) as Invitation | undefined;
    if (!row) return;
    if (row.status !== 'pending') return;
    const r = markRevokedStmt.run(revokedBy, id);
    if (r.changes > 0) {
      insertEvent.run('invite_revoked', row.inviter_id, JSON.stringify({ invitation_id: id, by: revokedBy }));
      ok = true;
    }
  });
  tx();
  return ok;
}
