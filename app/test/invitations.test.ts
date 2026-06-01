// Library-level tests for lib/invitations.ts.
// Tests share a database within the file (per CLAUDE.md "Testing patterns").
// We use unique emails + reset the invitations table between describes.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import { db } from '../src/db/index.js';
import * as settings from '../src/lib/settings.js';
import * as invitations from '../src/lib/invitations.js';
import { InvitationError } from '../src/lib/invitations.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';

beforeAll(() => {
  applySchema();
});

let nextEmailIdx = 0;
function uniqEmail(prefix = 'invitee') {
  return `${prefix}-${Date.now()}-${nextEmailIdx++}@example.test`;
}

function makeInviter(): { id: number; email: string; alias: string } {
  const email = uniqEmail('inviter');
  const alias = `inv_${Date.now().toString(36).slice(-4)}_${nextEmailIdx++}`;
  const u = findOrCreateUser(email, alias);
  return u;
}

beforeEach(() => {
  db.exec(`DELETE FROM invitations`);
  // Reset settings to defaults so quota is 2 and TTL is 72h.
  settings.set('invitations_per_operator', '2');
  settings.set('invite_token_ttl', '72h');
});

describe('createInvitation', () => {
  it('rejects when inviter at quota', () => {
    const inviter = makeInviter();
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    expect(() =>
      invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null })
    ).toThrowError(InvitationError);
  });

  it('accepts after revoke frees a slot', () => {
    const inviter = makeInviter();
    const a = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.revokeInvitation(a.id, 'operator');
    const c = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    expect(c.id).toBeGreaterThan(0);
  });

  it('accepts after expiry frees a slot', () => {
    const inviter = makeInviter();
    const a = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    // Force first to expire by rewriting expires_at directly in the past.
    db.prepare(`UPDATE invitations SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(a.id);
    const c = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    expect(c.id).toBeGreaterThan(0);
    const expired = invitations.findById(a.id)!;
    expect(expired.status).toBe('expired');
  });

  it('rejects duplicate pending email for same inviter', () => {
    const inviter = makeInviter();
    const target = uniqEmail();
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: target, note: null });
    expect(() =>
      invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: target, note: null })
    ).toThrow(/duplicate_email/);
  });

  it('rejects when invitee_email already exists in users', () => {
    const inviter = makeInviter();
    const existing = findOrCreateUser(uniqEmail(), `existing_${Date.now()}`);
    expect(() =>
      invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: existing.email, note: null })
    ).toThrow(/already_user/);
  });

  it('rejects self-invite', () => {
    const inviter = makeInviter();
    expect(() =>
      invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: inviter.email, note: null })
    ).toThrow(/self_invite/);
  });

  it('bypassQuota=true admin-override succeeds past 2', () => {
    const inviter = makeInviter();
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    const c = invitations.createInvitation({
      inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null,
      source: 'admin_override', bypassQuota: true,
    });
    expect(c.source).toBe('admin_override');
  });
});

describe('claimInvitation', () => {
  it('happy path: creates user, marks accepted, returns user', () => {
    const inviter = makeInviter();
    const inviteeEmail = uniqEmail('claimer');
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail, note: null });
    const r = invitations.claimInvitation({ token: inv.token, alias: `clm_${Date.now().toString(36)}` });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.user.email).toBe(inviteeEmail);
    expect(r.invitation.status).toBe('accepted');
    expect(r.invitation.claimed_user_id).toBe(r.user.id);
  });

  it('returns expired for past-TTL token', () => {
    const inviter = makeInviter();
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    db.prepare(`UPDATE invitations SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(inv.id);
    const r = invitations.claimInvitation({ token: inv.token, alias: `clm_${Date.now().toString(36)}` });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('expired');
  });

  it('returns already_used for status=accepted row', () => {
    const inviter = makeInviter();
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.claimInvitation({ token: inv.token, alias: `clm_${Date.now().toString(36)}_a` });
    const r2 = invitations.claimInvitation({ token: inv.token, alias: `clm_${Date.now().toString(36)}_b` });
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error('unreachable');
    expect(r2.reason).toBe('already_used');
  });

  it('returns revoked for status=revoked row', () => {
    const inviter = makeInviter();
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    invitations.revokeInvitation(inv.id, 'operator');
    const r = invitations.claimInvitation({ token: inv.token, alias: `clm_${Date.now().toString(36)}` });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('revoked');
  });

  it('returns alias_taken on alias collision', () => {
    const inviter = makeInviter();
    const taken = `taken_${Date.now().toString(36)}`;
    findOrCreateUser(uniqEmail('original'), taken);
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    const r = invitations.claimInvitation({ token: inv.token, alias: taken });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('alias_taken');
  });

  it('returns not_found for unknown token', () => {
    const r = invitations.claimInvitation({ token: 'no-such-token', alias: 'whoever' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('not_found');
  });
});

describe('sweepExpired', () => {
  it('flips pending past expires_at to expired and emits invite_expired events', () => {
    const inviter = makeInviter();
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    db.prepare(`UPDATE invitations SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(inv.id);
    db.exec(`DELETE FROM events WHERE kind = 'invite_expired'`);
    const n = invitations.sweepExpired();
    expect(n).toBeGreaterThanOrEqual(1);
    const events = db.prepare(`SELECT user_id, payload FROM events WHERE kind='invite_expired'`).all() as { user_id: number; payload: string }[];
    expect(events.length).toBeGreaterThanOrEqual(1);
    const found = events.find((e) => JSON.parse(e.payload).invitation_id === inv.id);
    expect(found).toBeTruthy();
  });

  it('correctly compares ISO-format expires_at against datetime("now")', () => {
    // Regression: createInvitation writes toISOString() (e.g. 2026-...T13:00Z),
    // but datetime('now') returns SQLite's space-separated form. A naive string
    // compare sorts them wrong because 'T' > ' '. Wrapping with datetime(...)
    // normalizes both sides.
    const inviter = makeInviter();
    const inv = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    // Stamp an ISO-format expiry one hour in the past (matches what
    // toISOString() would produce). This is the exact format the bug missed.
    const past = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`UPDATE invitations SET expires_at = ? WHERE id = ?`).run(past, inv.id);
    const n = invitations.sweepExpired();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(invitations.findById(inv.id)?.status).toBe('expired');
    // Quota should also see the slot as freed.
    const q = invitations.quotaFor(inviter.id);
    expect(q.used).toBe(0);
  });
});

describe('quotaFor', () => {
  it('counts pending+accepted, excludes expired/revoked', () => {
    const inviter = makeInviter();
    const a = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    const b = invitations.createInvitation({ inviterId: inviter.id, inviteeEmail: uniqEmail(), note: null });
    let q = invitations.quotaFor(inviter.id);
    expect(q.used).toBe(2);
    expect(q.available).toBe(0);
    invitations.revokeInvitation(a.id, 'operator');
    q = invitations.quotaFor(inviter.id);
    expect(q.used).toBe(1);
    db.prepare(`UPDATE invitations SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(b.id);
    q = invitations.quotaFor(inviter.id);
    expect(q.used).toBe(0);
    expect(q.available).toBe(2);
  });
});

describe('parseDuration', () => {
  it('parses 24h / 30m / 5d', () => {
    expect(invitations.parseDuration('24h')).toBe(24 * 3600 * 1000);
    expect(invitations.parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(invitations.parseDuration('5d')).toBe(5 * 86400 * 1000);
  });
  it('falls back to 72h on invalid input', () => {
    expect(invitations.parseDuration('garbage')).toBe(72 * 3600 * 1000);
    expect(invitations.parseDuration(null)).toBe(72 * 3600 * 1000);
  });
});
