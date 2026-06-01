// Per-player progress reads + atomic ordinal advance.
import { db } from '../db/index.js';
import { challenges, totalChallenges } from '../challenges/registry.js';

const selectProgress = db.prepare(`
  SELECT user_id, current_ordinal, last_advance_at, admin_skips, completed_at
  FROM user_progress WHERE user_id = ?
`);
const insertSolve = db.prepare(`
  INSERT OR IGNORE INTO solves (user_id, challenge_id, flag_source) VALUES (?, ?, ?)
`);
const insertAttempt = db.prepare(`
  INSERT INTO attempts (user_id, challenge_id, submitted, correct, ip, user_agent)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const advanceProgress = db.prepare(`
  UPDATE user_progress
  SET current_ordinal = current_ordinal + 1, last_advance_at = datetime('now')
  WHERE user_id = ? AND current_ordinal = ?
`);
const markCompleted = db.prepare(`
  UPDATE user_progress SET completed_at = datetime('now') WHERE user_id = ? AND completed_at IS NULL
`);
const incrementSkip = db.prepare(`
  UPDATE user_progress
  SET current_ordinal = current_ordinal + 1, admin_skips = admin_skips + 1, last_advance_at = datetime('now')
  WHERE user_id = ? AND current_ordinal = ?
`);
const insertEvent = db.prepare(`
  INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)
`);

export interface Progress {
  user_id: number;
  current_ordinal: number;
  last_advance_at: string;
  admin_skips: number;
  completed_at: string | null;
}

export function getProgress(userId: number): Progress | null {
  return (selectProgress.get(userId) as Progress | undefined) ?? null;
}

// Lock state for a (user, challenge) pair.
//   'live'    → can attempt
//   'archive' → already solved, read-only
//   'locked'  → ordinal in the future
export type LockState = 'live' | 'archive' | 'locked';

export function lockStateForOrdinal(userId: number, ordinal: number): LockState {
  const p = getProgress(userId);
  const cur = p?.current_ordinal ?? 1;
  if (ordinal < cur) return 'archive';
  if (ordinal > cur) return 'locked';
  return 'live';
}

// Atomic correct-flag handling: insert solve row, advance ordinal, mark completion if last.
export function recordCorrectSubmit(userId: number, challengeId: string, ordinal: number, ip: string | null, ua: string | null): { advanced: boolean; completed: boolean } {
  const tx = db.transaction(() => {
    insertAttempt.run(userId, challengeId, '<correct>', 1, ip, ua);
    insertSolve.run(userId, challengeId, 'player');
    const r = advanceProgress.run(userId, ordinal);
    const advanced = r.changes > 0;
    let completed = false;
    if (advanced && ordinal >= totalChallenges()) {
      markCompleted.run(userId);
      completed = true;
    }
    insertEvent.run('solve', userId, JSON.stringify({ challenge_id: challengeId, ordinal }));
    return { advanced, completed };
  });
  return tx();
}

export function recordWrongSubmit(userId: number, challengeId: string, submitted: string, ip: string | null, ua: string | null): void {
  insertAttempt.run(userId, challengeId, submitted, 0, ip, ua);
  insertEvent.run('attempt', userId, JSON.stringify({ challenge_id: challengeId, correct: 0 }));
}

// Admin skip: bumps ordinal + admin_skips, inserts synthetic solve row with flag_source='admin_skip'.
// Returns true if the skip applied (player was at the expected ordinal).
export function adminSkip(userId: number, expectedOrdinal: number): boolean {
  const tx = db.transaction(() => {
    const challenge = challenges.find((c) => c.ordinal === expectedOrdinal);
    if (!challenge) return false;
    const r = incrementSkip.run(userId, expectedOrdinal);
    if (r.changes === 0) return false;
    insertSolve.run(userId, challenge.id, 'admin_skip');
    if (expectedOrdinal >= totalChallenges()) markCompleted.run(userId);
    insertEvent.run('admin_skip', userId, JSON.stringify({ challenge_id: challenge.id, ordinal: expectedOrdinal }));
    return true;
  });
  return tx();
}
