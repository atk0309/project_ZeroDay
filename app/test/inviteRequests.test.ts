// Tests for lib/inviteRequests.ts.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import { db } from '../src/db/index.js';
import * as inviteRequests from '../src/lib/inviteRequests.js';
import * as invitations from '../src/lib/invitations.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';

beforeAll(() => applySchema());

let n = 0;
function uniqEmail(prefix = 'requester') {
  return `${prefix}-${Date.now()}-${n++}@example.test`;
}
function makeUser() {
  const email = uniqEmail();
  const alias = `req_${Date.now().toString(36).slice(-4)}_${n++}`;
  return findOrCreateUser(email, alias);
}

beforeEach(() => {
  db.exec(`DELETE FROM invite_requests`);
  db.exec(`DELETE FROM invitations`);
});

describe('createRequest', () => {
  it('rejects second pending for same requester', () => {
    const u = makeUser();
    inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail('target'), reason: 'first try' });
    expect(() =>
      inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail('target2'), reason: 'second try' })
    ).toThrow(/pending_exists/);
  });

  it('accepts after prior request is decided', () => {
    const u = makeUser();
    const first = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail(), reason: 'r' });
    inviteRequests.denyRequest({ id: first.id, adminEmail: 'admin@x', note: 'no.' });
    const second = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail(), reason: 'try again' });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
  });

  it('rejects empty reason', () => {
    const u = makeUser();
    expect(() => inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: null, reason: '   ' })).toThrow();
  });
});

describe('approveRequest', () => {
  it('spawns invitations row with source=admin_grant', () => {
    const u = makeUser();
    const target = uniqEmail('grant');
    const r = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: target, reason: 'study group' });
    const out = inviteRequests.approveRequest({ id: r.id, adminEmail: 'admin@x', note: 'ok' });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.invitation.source).toBe('admin_grant');
    expect(out.invitation.invitee_email).toBe(target);
    const reqRow = inviteRequests.findById(r.id)!;
    expect(reqRow.status).toBe('approved');
    expect(reqRow.granted_invitation_id).toBe(out.invitation.id);
  });

  it('is idempotent: second call returns not_pending', () => {
    const u = makeUser();
    const r = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail(), reason: 'r' });
    inviteRequests.approveRequest({ id: r.id, adminEmail: 'admin@x', note: null });
    const second = inviteRequests.approveRequest({ id: r.id, adminEmail: 'admin@x', note: null });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.reason).toBe('not_pending');
  });

  it('bypasses inviter quota when approving', () => {
    const u = makeUser();
    invitations.createInvitation({ inviterId: u.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: u.id, inviteeEmail: uniqEmail(), note: null });
    const target = uniqEmail('grant');
    const r = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: target, reason: 'r' });
    const out = inviteRequests.approveRequest({ id: r.id, adminEmail: 'admin@x', note: null });
    expect(out.ok).toBe(true);
  });
});

describe('denyRequest', () => {
  it('sets status + decision_note + decided_by', () => {
    const u = makeUser();
    const r = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail(), reason: 'pls' });
    const out = inviteRequests.denyRequest({ id: r.id, adminEmail: 'admin@x', note: 'cohort cap' });
    expect(out.ok).toBe(true);
    const row = inviteRequests.findById(r.id)!;
    expect(row.status).toBe('denied');
    expect(row.decision_note).toBe('cohort cap');
    expect(row.decided_by).toBe('admin@x');
  });

  it('rejects without note', () => {
    const u = makeUser();
    const r = inviteRequests.createRequest({ requesterId: u.id, inviteeEmail: uniqEmail(), reason: 'r' });
    const out = inviteRequests.denyRequest({ id: r.id, adminEmail: 'admin@x', note: '' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('note_required');
  });
});
