// DB-backed app_settings with a 30s read-through cache.
// Replaces .env for runtime concerns: launch/end timestamps, mail config,
// admin email, admin password hash. Writes invalidate the cache.

import { db } from '../db/index.js';

export type SettingKey =
  | 'launch_at'
  | 'end_at'
  | 'admin_email'
  | 'admin_password_hash'
  | 'mail_provider'        // 'resend' | 'smtp'
  | 'mail_credentials'     // JSON string
  | 'mail_from'
  | 'mail_configured'      // 'true' | 'false'
  | 'recruit_email_body'
  | 'lobby_flavor'         // newline-separated lines
  | 'invitations_per_operator'  // default '2'
  | 'invite_token_ttl'          // default '72h'
  | 'invite_email_subject'      // default DEFAULT_INVITE_SUBJECT
  | 'invite_email_body'         // default DEFAULT_INVITE_EMAIL_BODY
  | 'accept_confirm_email_subject'   // default DEFAULT_ACCEPT_CONFIRM_SUBJECT
  | 'accept_confirm_email_body'      // default DEFAULT_ACCEPT_CONFIRM_BODY
  | 'request_received_email_subject' // default DEFAULT_REQUEST_RECEIVED_SUBJECT
  | 'request_received_email_body'    // default DEFAULT_REQUEST_RECEIVED_BODY
  | 'request_approved_email_subject' // default DEFAULT_REQUEST_APPROVED_SUBJECT
  | 'request_approved_email_body'    // default DEFAULT_REQUEST_APPROVED_BODY
  | 'request_denied_email_subject'   // default DEFAULT_REQUEST_DENIED_SUBJECT
  | 'request_denied_email_body'      // default DEFAULT_REQUEST_DENIED_BODY
  | 'admin_reset_nonce';             // last consumed RESET_ADMIN_SAFETY (see lib/adminReset.ts)

const TTL_MS = 30_000;

let cache: Map<string, string | null> | null = null;
let cacheLoadedAt = 0;

const selectAll = db.prepare(`SELECT key, value FROM app_settings`);
const selectOne = db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
const upsert = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
`);
const remove = db.prepare(`DELETE FROM app_settings WHERE key = ?`);

function loadCache(): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const row of selectAll.all() as { key: string; value: string | null }[]) {
    m.set(row.key, row.value);
  }
  return m;
}

function ensureFresh() {
  if (cache && Date.now() - cacheLoadedAt < TTL_MS) return;
  cache = loadCache();
  cacheLoadedAt = Date.now();
}

export function get(key: SettingKey): string | null {
  ensureFresh();
  return cache!.get(key) ?? null;
}

export function getAll(): Record<string, string | null> {
  ensureFresh();
  return Object.fromEntries(cache!.entries());
}

export function set(key: SettingKey, value: string | null): void {
  if (value === null) {
    remove.run(key);
  } else {
    upsert.run(key, value);
  }
  // Invalidate; next read reloads.
  cache = null;
}

export function setMany(entries: Partial<Record<SettingKey, string | null>>): void {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(entries)) {
      if (v === null || v === undefined) remove.run(k);
      else upsert.run(k, v);
    }
  });
  tx();
  cache = null;
}

// Direct DB read that bypasses the cache. Used in tests and where an authoritative
// fresh read is needed (e.g. immediately after a write in the same request).
export function getFresh(key: SettingKey): string | null {
  const row = selectOne.get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function invalidateCache(): void {
  cache = null;
}
