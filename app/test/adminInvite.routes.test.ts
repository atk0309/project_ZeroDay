// HTTP tests for the admin invitation/request JSON API.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import { db } from '../src/db/index.js';
import * as settings from '../src/lib/settings.js';
import * as invitations from '../src/lib/invitations.js';
import * as inviteRequests from '../src/lib/inviteRequests.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';
import { createSession as createAdminSession, SESSION_COOKIE as ADMIN_COOKIE, bootstrapPassword } from '../src/lib/adminAuth.js';

let n = 0;
function uniqEmail(prefix = 'op') {
  return `${prefix}-${Date.now()}-${n++}@example.test`;
}
function makeOperator() {
  const email = uniqEmail();
  const alias = `op_${Date.now().toString(36).slice(-4)}_${n++}`;
  return findOrCreateUser(email, alias);
}

beforeAll(async () => {
  applySchema();
  if (!settings.get('admin_password_hash')) {
    await bootstrapPassword('hunter2hunter2');
  }
});

beforeEach(() => {
  db.exec(`DELETE FROM invitations`);
  db.exec(`DELETE FROM invite_requests`);
  db.exec(`DELETE FROM admin_audit_log`);
});

function asAdmin(): string {
  const sid = createAdminSession('admin@example.com', '127.0.0.1', 'curl/test');
  return `${ADMIN_COOKIE}=${sid}`;
}

describe('admin invitation API auth', () => {
  it('returns 401 without admin session', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/admin/api/invitations' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('unauthorized');
  });
});

describe('POST /admin/api/invitations (override)', () => {
  it('bypasses quota + audits', async () => {
    const app = await build();
    const op = makeOperator();
    invitations.createInvitation({ inviterId: op.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: op.id, inviteeEmail: uniqEmail(), note: null });
    const target = uniqEmail('override');
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ inviter_id: op.id, invitee_email: target, note: 'override note' }),
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.ok).toBe(true);
    expect(j.invitation.source).toBe('admin_override');
    const audit = db.prepare(`SELECT * FROM admin_audit_log WHERE action='invite_send'`).get() as { target: string } | undefined;
    expect(audit).toBeTruthy();
    expect(audit!.target).toBe(String(j.invitation.id));
  });

  it('returns 400 on invalid email', async () => {
    const app = await build();
    const op = makeOperator();
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ inviter_id: op.id, invitee_email: 'no-at-sign' }),
    });
    expect(r.statusCode).toBe(400);
  });

  it('returns 400 unknown_inviter on a non-existent inviter_id', async () => {
    const app = await build();
    const ghostId = 9_999_999;
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ inviter_id: ghostId, invitee_email: uniqEmail('ghost') }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('unknown_inviter');
  });

  it('accepts inviter_id=null with a custom alias and persists the override', async () => {
    const app = await build();
    const target = uniqEmail('seed');
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        inviter_id: null,
        invitee_email: target,
        inviter_alias_override: 'wopr',
        note: 'first operator',
      }),
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.invitation.inviter_id).toBe(null);
    expect(j.invitation.inviter_alias_override).toBe('wopr');
    expect(j.invitation.source).toBe('admin_override');
  });

  it('rejects inviter_id=null without a custom alias', async () => {
    const app = await build();
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        inviter_id: null,
        invitee_email: uniqEmail('lone'),
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('inviter_required');
  });
});

describe('GET /claim/:token displays inviter alias', () => {
  it('shows the custom override when set, even after admin session ends', async () => {
    const app = await build();
    const target = uniqEmail('claim');
    const r = await app.inject({
      method: 'POST', url: '/admin/api/invitations',
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        inviter_id: null,
        invitee_email: target,
        inviter_alias_override: 'wopr',
      }),
    });
    expect(r.statusCode).toBe(200);
    const token = r.json().invitation.token;
    const page = await app.inject({ method: 'GET', url: `/claim/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('wopr');
  });
});

describe('POST /admin/api/invitations/:id/revoke', () => {
  it('writes audit + flips row', async () => {
    const app = await build();
    const op = makeOperator();
    const inv = invitations.createInvitation({ inviterId: op.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'POST', url: `/admin/api/invitations/${inv.id}/revoke`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(r.statusCode).toBe(200);
    expect(invitations.findById(inv.id)?.status).toBe('revoked');
    const audit = db.prepare(`SELECT * FROM admin_audit_log WHERE action='invite_revoke'`).get();
    expect(audit).toBeTruthy();
  });
});

describe('POST /admin/api/invite-requests/:id/approve', () => {
  it('audits + spawns invitation', async () => {
    const app = await build();
    const op = makeOperator();
    const target = uniqEmail('approve');
    const reqRow = inviteRequests.createRequest({ requesterId: op.id, inviteeEmail: target, reason: 'study group' });
    const r = await app.inject({
      method: 'POST', url: `/admin/api/invite-requests/${reqRow.id}/approve`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ note: 'approved · cohort+1' }),
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.ok).toBe(true);
    expect(j.invitation.source).toBe('admin_grant');
    expect(j.invitation.invitee_email).toBe(target);
    const audit = db.prepare(`SELECT * FROM admin_audit_log WHERE action='request_approve'`).get();
    expect(audit).toBeTruthy();
  });
});

describe('POST /admin/api/invite-requests/:id/deny', () => {
  it('without note rejects', async () => {
    const app = await build();
    const op = makeOperator();
    const reqRow = inviteRequests.createRequest({ requesterId: op.id, inviteeEmail: uniqEmail(), reason: 'r' });
    const r = await app.inject({
      method: 'POST', url: `/admin/api/invite-requests/${reqRow.id}/deny`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(400);
  });

  it('with note flips status + audits', async () => {
    const app = await build();
    const op = makeOperator();
    const reqRow = inviteRequests.createRequest({ requesterId: op.id, inviteeEmail: uniqEmail(), reason: 'r' });
    const r = await app.inject({
      method: 'POST', url: `/admin/api/invite-requests/${reqRow.id}/deny`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ note: 'cohort cap' }),
    });
    expect(r.statusCode).toBe(200);
    expect(inviteRequests.findById(reqRow.id)?.status).toBe('denied');
    const audit = db.prepare(`SELECT * FROM admin_audit_log WHERE action='request_deny'`).get();
    expect(audit).toBeTruthy();
  });
});

describe('GET /admin/api/invitations stats shape', () => {
  it('returns sent/pending/accepted/etc', async () => {
    const app = await build();
    const op = makeOperator();
    invitations.createInvitation({ inviterId: op.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'GET', url: '/admin/api/invitations',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.stats).toBeTruthy();
    expect(j.stats.sent).toBeGreaterThanOrEqual(1);
    expect(j.stats.pending).toBeGreaterThanOrEqual(1);
  });
});
