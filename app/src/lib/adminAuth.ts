// Admin auth state + session management.
//
// State machine (derived from app_settings):
//   uninitialized   → admin_password_hash IS NULL.   Only path in is the 5-click easter egg.
//   password-set    → password set, mail not configured. Login works (password). Magic link disabled.
//   mail-configured → mail provider verified.        Magic link enabled. Password still works.
//
// Session cookie is `admin_session`, stored server-side in admin_sessions.

import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../db/index.js';
import * as settings from './settings.js';

export type AdminState = 'uninitialized' | 'password-set' | 'mail-configured';

export const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;       // 12h idle
const SESSION_ABS_MS = 7 * 24 * 60 * 60 * 1000;   // 7d absolute

const insertSession = db.prepare(`
  INSERT INTO admin_sessions (id, email, ip, user_agent, created_at, last_seen_at, expires_at)
  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)
`);
const findSession = db.prepare(`
  SELECT id, email, ip, user_agent, created_at, last_seen_at, expires_at FROM admin_sessions WHERE id = ?
`);
const listSessionsForEmail = db.prepare(`
  SELECT id, email, ip, user_agent, created_at, last_seen_at, expires_at
  FROM admin_sessions
  WHERE email = ? AND datetime(expires_at) > datetime('now')
  ORDER BY last_seen_at DESC
`);
const touchSession = db.prepare(`
  UPDATE admin_sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id = ?
`);
const deleteSession = db.prepare(`DELETE FROM admin_sessions WHERE id = ?`);
const deleteOtherSessions = db.prepare(`
  DELETE FROM admin_sessions WHERE email = ? AND id != ?
`);
const insertMagic = db.prepare(`
  INSERT INTO admin_magic_links (token, email, created_at, expires_at)
  VALUES (?, ?, datetime('now'), ?)
`);
const findMagic = db.prepare(`
  SELECT token, email, expires_at, consumed_at FROM admin_magic_links WHERE token = ?
`);
const consumeMagic = db.prepare(`
  UPDATE admin_magic_links SET consumed_at = datetime('now') WHERE token = ? AND consumed_at IS NULL
`);

export function adminState(): AdminState {
  if (!settings.get('admin_password_hash')) return 'uninitialized';
  if (settings.get('mail_configured') === 'true') return 'mail-configured';
  return 'password-set';
}

// Bootstrap: store the first admin password. Refuses if one already exists
// (so the easter egg can't accidentally overwrite). Returns the email used.
export async function bootstrapPassword(password: string, email?: string): Promise<string> {
  if (settings.get('admin_password_hash')) {
    throw new Error('admin password already set');
  }
  if (!password || password.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  const adminEmail = (email && email.includes('@')) ? email : (settings.get('admin_email') ?? 'admin@example.com');
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  settings.setMany({ admin_password_hash: hash, admin_email: adminEmail });
  return adminEmail;
}

// Verify password against the stored hash. Constant-time via argon2.verify.
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const adminEmail = settings.get('admin_email');
  const hash = settings.get('admin_password_hash');
  if (!adminEmail || !hash) return false;
  if (email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function changePassword(newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  settings.set('admin_password_hash', hash);
}

export interface AdminSessionRow {
  id: string;
  email: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

// Create a session row + return the cookie value (the session id).
export function createSession(email: string, ip?: string | null, userAgent?: string | null): string {
  const id = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession.run(id, email, ip ?? null, userAgent ?? null, expires);
  return id;
}

// List all live (non-expired) sessions for an admin email.
export function listSessions(email: string): AdminSessionRow[] {
  return listSessionsForEmail.all(email) as AdminSessionRow[];
}

// Terminate every session for `email` except `keepId`. Used after a password
// rotation: end every other session.
export function destroyOtherSessions(email: string, keepId: string): number {
  const r = deleteOtherSessions.run(email, keepId);
  return Number(r.changes ?? 0);
}

export function readSession(cookieValue: string | undefined | null): { email: string } | null {
  if (!cookieValue) return null;
  const row = findSession.get(cookieValue) as { id: string; email: string; created_at: string; expires_at: string } | undefined;
  if (!row) return null;
  const now = Date.now();
  const expires = new Date(row.expires_at).getTime();
  const created = new Date(row.created_at).getTime();
  if (now > expires || now > created + SESSION_ABS_MS) {
    deleteSession.run(row.id);
    return null;
  }
  // Slide expiration on each successful read.
  touchSession.run(new Date(now + SESSION_TTL_MS).toISOString(), row.id);
  return { email: row.email };
}

export function destroySession(cookieValue: string | undefined | null): void {
  if (cookieValue) deleteSession.run(cookieValue);
}

// Magic-link issue/consume.
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes
export function issueMagicLink(email: string): string {
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + MAGIC_TTL_MS).toISOString();
  insertMagic.run(token, email, expires);
  return token;
}
export function consumeMagicLink(token: string): { email: string } | null {
  const row = findMagic.get(token) as { token: string; email: string; expires_at: string; consumed_at: string | null } | undefined;
  if (!row) return null;
  if (row.consumed_at) return null;
  if (Date.now() > new Date(row.expires_at).getTime()) return null;
  const r = consumeMagic.run(token);
  if (r.changes === 0) return null;
  return { email: row.email };
}
