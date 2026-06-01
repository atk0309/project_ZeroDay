// Tests the boot-time admin reset gated by RESET_ADMIN + RESET_ADMIN_SAFETY.
// Invariant #6 (extended): clears admin_password_hash so the 5-click easter
// egg arms; consume-once via app_settings.admin_reset_nonce.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import { maybeResetAdmin } from '../src/lib/adminReset.js';
import * as settings from '../src/lib/settings.js';
import { db } from '../src/db/index.js';

beforeAll(() => applySchema());

beforeEach(() => {
  settings.set('admin_password_hash', 'pretend-argon2-hash');
  settings.set('admin_reset_nonce', null);
  db.prepare(`DELETE FROM admin_audit_log WHERE action = 'admin_reset_via_env'`).run();
});

function auditRows() {
  return db.prepare(
    `SELECT email, action, payload FROM admin_audit_log WHERE action = 'admin_reset_via_env' ORDER BY id ASC`,
  ).all() as { email: string; action: string; payload: string | null }[];
}

describe('maybeResetAdmin', () => {
  it('no-op when RESET_ADMIN is unset', () => {
    const r = maybeResetAdmin({});
    expect(r.reset).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(settings.get('admin_password_hash')).toBe('pretend-argon2-hash');
  });

  it('no-op when RESET_ADMIN is anything other than "true"', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', '']) {
      const r = maybeResetAdmin({ RESET_ADMIN: v, RESET_ADMIN_SAFETY: '99' });
      expect(r.reset, `value=${JSON.stringify(v)}`).toBe(false);
      expect(r.reason).toBe('disabled');
    }
    expect(settings.get('admin_password_hash')).toBe('pretend-argon2-hash');
  });

  it('refuses when RESET_ADMIN=true but no nonce', () => {
    const r = maybeResetAdmin({ RESET_ADMIN: 'true' });
    expect(r.reset).toBe(false);
    expect(r.reason).toBe('no-nonce');
    expect(settings.get('admin_password_hash')).toBe('pretend-argon2-hash');
  });

  it('refuses non-positive-integer nonces', () => {
    for (const bad of ['abc', '1.5', '-3', '+1', '01', '0', ' ', 'NaN']) {
      const r = maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: bad });
      expect(r.reset, `bad=${JSON.stringify(bad)}`).toBe(false);
      // Whitespace-only and empty parse as 'no-nonce' since we trim first.
      expect(['invalid-nonce', 'no-nonce']).toContain(r.reason);
    }
    expect(settings.get('admin_password_hash')).toBe('pretend-argon2-hash');
  });

  it('resets on first valid run and persists the nonce', () => {
    const r = maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '1' });
    expect(r.reset).toBe(true);
    expect(r.reason).toBe('done');
    expect(r.nonce).toBe(1);
    expect(r.previousNonce).toBe(0);
    expect(settings.get('admin_password_hash')).toBeNull();
    expect(settings.get('admin_reset_nonce')).toBe('1');
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('system');
    expect(JSON.parse(rows[0].payload!)).toEqual({ nonce: 1, previousNonce: 0 });
  });

  it('is consume-once: same nonce on second boot is a no-op', () => {
    expect(maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '1' }).reset).toBe(true);
    // Operator forgets to unset → next boot re-runs maybeResetAdmin with same vars.
    // Simulate an admin re-claiming via the easter egg in between.
    settings.set('admin_password_hash', 'second-argon2-hash');
    const r = maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '1' });
    expect(r.reset).toBe(false);
    expect(r.reason).toBe('nonce-not-advanced');
    expect(settings.get('admin_password_hash')).toBe('second-argon2-hash');
    expect(auditRows()).toHaveLength(1); // no new audit row
  });

  it('lower nonce after a higher one is rejected', () => {
    expect(maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '7' }).reset).toBe(true);
    settings.set('admin_password_hash', 'new-hash');
    const r = maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '3' });
    expect(r.reset).toBe(false);
    expect(r.reason).toBe('nonce-not-advanced');
    expect(settings.get('admin_password_hash')).toBe('new-hash');
  });

  it('bumping the nonce re-arms the reset', () => {
    expect(maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '1' }).reset).toBe(true);
    settings.set('admin_password_hash', 'second-hash');
    const r = maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '2' });
    expect(r.reset).toBe(true);
    expect(r.previousNonce).toBe(1);
    expect(r.nonce).toBe(2);
    expect(settings.get('admin_password_hash')).toBeNull();
    expect(settings.get('admin_reset_nonce')).toBe('2');
    expect(auditRows()).toHaveLength(2);
  });

  it('flipping RESET_ADMIN to false after a reset means subsequent boots are no-op', () => {
    expect(maybeResetAdmin({ RESET_ADMIN: 'true', RESET_ADMIN_SAFETY: '5' }).reset).toBe(true);
    settings.set('admin_password_hash', 'new-hash');
    const r = maybeResetAdmin({ RESET_ADMIN: 'false', RESET_ADMIN_SAFETY: '6' });
    expect(r.reset).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(settings.get('admin_password_hash')).toBe('new-hash');
  });
});
