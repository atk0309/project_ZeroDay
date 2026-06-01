// Player auth: signup, magic-link login, sessions.
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../db/index.js';

export const PLAYER_COOKIE = 'player_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAGIC_TTL_MS = 15 * 60 * 1000;             // 15 minutes

const findUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const insertUser = db.prepare(`
  INSERT INTO users (email, alias, flag_salt) VALUES (?, ?, ?)
`);
const ensureProgress = db.prepare(`
  INSERT INTO user_progress (user_id) VALUES (?)
  ON CONFLICT(user_id) DO NOTHING
`);
const insertMagic = db.prepare(`
  INSERT INTO magic_links (token, user_id, purpose, expires_at)
  VALUES (?, ?, ?, ?)
`);
const findMagic = db.prepare(`
  SELECT token, user_id, purpose, expires_at, consumed_at FROM magic_links WHERE token = ?
`);
const consumeMagic = db.prepare(`
  UPDATE magic_links SET consumed_at = datetime('now') WHERE token = ? AND consumed_at IS NULL
`);
const markVerified = db.prepare(`
  UPDATE users SET verified_at = datetime('now') WHERE id = ? AND verified_at IS NULL
`);
const insertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
`);
const findSession = db.prepare(`
  SELECT id, user_id, expires_at FROM sessions WHERE id = ?
`);
const touchSession = db.prepare(`
  UPDATE sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id = ?
`);
const deleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const touchUser = db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`);

export interface User {
  id: number;
  email: string;
  alias: string;
  created_at: string;
  verified_at: string | null;
  last_seen_at: string | null;
  flag_salt: string;
  frozen_at: string | null;
  frozen_reason: string | null;
  cheat_strikes: number;
}

export function findOrCreateUser(email: string, alias: string): User {
  const existing = findUserByEmail.get(email) as User | undefined;
  if (existing) return existing;
  const salt = randomBytes(16).toString('hex');
  const r = insertUser.run(email, alias, salt);
  ensureProgress.run(r.lastInsertRowid);
  return findUserById.get(r.lastInsertRowid) as User;
}

export function getUserByEmail(email: string): User | null {
  return (findUserByEmail.get(email) as User | undefined) ?? null;
}

export function getUserById(id: number): User | null {
  return (findUserById.get(id) as User | undefined) ?? null;
}

export function issueMagicLink(userId: number, purpose: 'signup' | 'login'): string {
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + MAGIC_TTL_MS).toISOString();
  insertMagic.run(token, userId, purpose, expires);
  return token;
}

export function consumeMagicLinkToken(token: string): { user: User; purpose: string } | null {
  const row = findMagic.get(token) as { token: string; user_id: number; purpose: string; expires_at: string; consumed_at: string | null } | undefined;
  if (!row || row.consumed_at) return null;
  if (Date.now() > new Date(row.expires_at).getTime()) return null;
  const r = consumeMagic.run(token);
  if (r.changes === 0) return null;
  if (row.purpose === 'signup') markVerified.run(row.user_id);
  ensureProgress.run(row.user_id);
  const user = findUserById.get(row.user_id) as User;
  return { user, purpose: row.purpose };
}

export function createSession(userId: number): string {
  const id = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession.run(id, userId, expires);
  return id;
}

export function readSession(cookieValue: string | undefined | null): User | null {
  if (!cookieValue) return null;
  const row = findSession.get(cookieValue) as { id: string; user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.now() > new Date(row.expires_at).getTime()) {
    deleteSession.run(row.id);
    return null;
  }
  touchSession.run(new Date(Date.now() + SESSION_TTL_MS).toISOString(), row.id);
  touchUser.run(row.user_id);
  return findUserById.get(row.user_id) as User;
}

export function destroySession(cookieValue: string | undefined | null): void {
  if (cookieValue) deleteSession.run(cookieValue);
}
