// Boot-time admin-password reset, gated by two env vars set on the host
// (Railway / VPS), so it can only be triggered by someone with infra access:
//
//   RESET_ADMIN=true
//   RESET_ADMIN_SAFETY=<positive integer, strictly greater than the stored one>
//
// Both must be present. The nonce is consume-once: after a successful reset we
// persist the value in app_settings.admin_reset_nonce, and any future boot with
// the same (or lower) nonce is a no-op even if RESET_ADMIN is still 'true'.
// That way leaving the var set across redeploys does NOT keep wiping admin —
// the operator must explicitly bump the counter for the next reset to fire.
//
// The reset itself clears admin_password_hash so adminState() → 'uninitialized'
// and the 5-click easter egg at /admin/login arms again. admin_email is left
// alone. An audit-log entry (action 'admin_reset_via_env') records the event
// for post-mortem even if an attacker who wins the post-reset race tries to
// scrub their tracks.

import { db } from '../db/index.js';
import * as settings from './settings.js';

export type ResetReason =
  | 'disabled'             // RESET_ADMIN not 'true'
  | 'no-nonce'             // RESET_ADMIN_SAFETY unset/empty
  | 'invalid-nonce'        // not a positive integer
  | 'nonce-not-advanced'   // <= stored value, already consumed
  | 'done';

export interface ResetOutcome {
  reset: boolean;
  reason: ResetReason;
  nonce?: number;
  previousNonce?: number;
}

const insertAudit = db.prepare(`
  INSERT INTO admin_audit_log (email, action, target, payload, ip)
  VALUES (?, ?, ?, ?, ?)
`);

export function maybeResetAdmin(env: NodeJS.ProcessEnv = process.env): ResetOutcome {
  if (env.RESET_ADMIN !== 'true') return { reset: false, reason: 'disabled' };

  const raw = (env.RESET_ADMIN_SAFETY ?? '').trim();
  if (!raw) return { reset: false, reason: 'no-nonce' };

  // Strict positive-integer parse. Reject 'abc', '1.5', '-3', '+1', '01'.
  if (!/^[1-9][0-9]*$/.test(raw)) return { reset: false, reason: 'invalid-nonce' };
  const nonce = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(nonce)) return { reset: false, reason: 'invalid-nonce' };

  const storedRaw = settings.getFresh('admin_reset_nonce');
  const stored = storedRaw && /^[0-9]+$/.test(storedRaw) ? Number.parseInt(storedRaw, 10) : 0;
  if (nonce <= stored) {
    return { reset: false, reason: 'nonce-not-advanced', nonce, previousNonce: stored };
  }

  // Clear admin password + record new nonce + write audit row, atomically.
  const tx = db.transaction(() => {
    settings.setMany({
      admin_password_hash: null,
      admin_reset_nonce: String(nonce),
    });
    insertAudit.run('system', 'admin_reset_via_env', null, JSON.stringify({ nonce, previousNonce: stored }), null);
  });
  tx();

  return { reset: true, reason: 'done', nonce, previousNonce: stored };
}
