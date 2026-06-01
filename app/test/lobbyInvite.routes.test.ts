// HTTP tests for the operator lobby invite routes + the public claim flow.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import { db } from '../src/db/index.js';
import * as settings from '../src/lib/settings.js';
import * as invitations from '../src/lib/invitations.js';
import * as inviteRequests from '../src/lib/inviteRequests.js';
import { findOrCreateUser, createSession, PLAYER_COOKIE } from '../src/lib/playerAuth.js';

let n = 0;
function uniqEmail(prefix = 'op') {
  return `${prefix}-${Date.now()}-${n++}@example.test`;
}
function makeOperator() {
  const email = uniqEmail();
  const alias = `op_${Date.now().toString(36).slice(-4)}_${n++}`;
  const u = findOrCreateUser(email, alias);
  const sid = createSession(u.id);
  return { user: u, cookie: `${PLAYER_COOKIE}=${sid}` };
}

beforeAll(() => {
  applySchema();
  settings.setMany({
    launch_at: new Date(Date.now() + 86400_000).toISOString(), // prelaunch
    end_at:    new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  settings.set('invitations_per_operator', '2');
  settings.set('invite_token_ttl', '72h');
});

beforeEach(() => {
  db.exec(`DELETE FROM invitations`);
  db.exec(`DELETE FROM invite_requests`);
});

describe('POST /lobby/invite', () => {
  it('redirects to /recruit without a player session', async () => {
    const app = await build();
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=foo@bar.test',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/recruit');
  });

  it('happy path emits invite_sent + 303 with msg=invited', async () => {
    const app = await build();
    const op = makeOperator();
    const target = uniqEmail('target');
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite',
      headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `email=${encodeURIComponent(target)}&note=because`,
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toMatch(/\/\?msg=invited/);
    const ev = db.prepare(`SELECT * FROM events WHERE kind='invite_sent' AND user_id=?`).get(op.user.id) as { payload: string } | undefined;
    expect(ev).toBeTruthy();
    expect(JSON.parse(ev!.payload).invitee_email).toBe(target);
  });

  it('responds with err_quota when at the limit', async () => {
    const app = await build();
    const op = makeOperator();
    invitations.createInvitation({ inviterId: op.user.id, inviteeEmail: uniqEmail(), note: null });
    invitations.createInvitation({ inviterId: op.user.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite',
      headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `email=${encodeURIComponent(uniqEmail())}`,
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain('msg=err_quota');
  });

  it('responds with err_invalid_email when bad', async () => {
    const app = await build();
    const op = makeOperator();
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite',
      headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=not-an-email',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain('msg=err_invalid_email');
  });
});

describe('POST /lobby/invite/:id/revoke', () => {
  it('non-owner gets 403', async () => {
    const app = await build();
    const owner = makeOperator();
    const other = makeOperator();
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'POST', url: `/lobby/invite/${inv.id}/revoke`,
      headers: { cookie: other.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(r.statusCode).toBe(403);
  });

  it('owner can revoke and gets msg=revoked', async () => {
    const app = await build();
    const owner = makeOperator();
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'POST', url: `/lobby/invite/${inv.id}/revoke`,
      headers: { cookie: owner.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain('msg=revoked');
    expect(invitations.findById(inv.id)?.status).toBe('revoked');
  });
});

describe('claim flow', () => {
  it('GET /claim/:token unknown renders claim-dead', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/claim/never-existed' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('this link is dead');
  });

  it('GET /claim/:token expired renders claim-dead', async () => {
    const app = await build();
    const owner = makeOperator();
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: uniqEmail(), note: null });
    db.prepare(`UPDATE invitations SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(inv.id);
    const r = await app.inject({ method: 'GET', url: `/claim/${inv.token}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('this link is dead');
    expect(r.body).toContain('expired');
  });

  it('POST /claim/:token sets PLAYER_COOKIE on success and 303s to /', async () => {
    const app = await build();
    const owner = makeOperator();
    const target = uniqEmail('claimer');
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: target, note: null });
    const r = await app.inject({
      method: 'POST', url: `/claim/${inv.token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `alias=newop_${Date.now().toString(36)}`,
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/');
    const sessionCookie = r.cookies.find((c) => c.name === PLAYER_COOKIE);
    expect(sessionCookie).toBeTruthy();
  });

  it('POST /claim/:token alias collision re-renders form with error', async () => {
    const app = await build();
    const owner = makeOperator();
    const taken = `claim_taken_${Date.now().toString(36)}`;
    findOrCreateUser(uniqEmail('original'), taken);
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: uniqEmail('claim'), note: null });
    const r = await app.inject({
      method: 'POST', url: `/claim/${inv.token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `alias=${taken}`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('alias already taken');
  });

  it('POST /claim/:token short alias rerenders with error', async () => {
    const app = await build();
    const owner = makeOperator();
    const inv = invitations.createInvitation({ inviterId: owner.user.id, inviteeEmail: uniqEmail(), note: null });
    const r = await app.inject({
      method: 'POST', url: `/claim/${inv.token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'alias=ab',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('alias must be 3–20');
  });
});

describe('POST /lobby/invite mail-failure surfacing', () => {
  it('returns msg=err_mail_failed + dev_link when send fails but invite was created', async () => {
    // Configure mail so isConfigured() returns true but the actual send falls
    // into mail.ts's catch block (the lazy-import + bad call surface as
    // { ok: false }). The invitation row is still created — the route must
    // surface the failure rather than reporting unconditional success.
    settings.setMany({
      mail_provider: 'resend',
      mail_credentials: JSON.stringify({ apiKey: '' }),
      mail_from: 'noreply@example.test',
      mail_configured: 'true',
    });
    try {
      const app = await build();
      const op = makeOperator();
      const target = uniqEmail('mailfail');
      const r = await app.inject({
        method: 'POST', url: '/lobby/invite',
        headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: `email=${encodeURIComponent(target)}`,
      });
      expect(r.statusCode).toBe(302);
      const loc = r.headers.location ?? '';
      expect(loc).toContain('msg=err_mail_failed');
      expect(loc).toContain('dev_link=');
      // Slot is consumed because the row was created.
      const created = db.prepare(`SELECT * FROM invitations WHERE invitee_email = ?`).get(target);
      expect(created).toBeTruthy();
    } finally {
      settings.set('mail_configured', 'false');
    }
  });
});

describe('POST /lobby/invite-request', () => {
  it('rejects 2nd pending', async () => {
    const app = await build();
    const op = makeOperator();
    inviteRequests.createRequest({ requesterId: op.user.id, inviteeEmail: null, reason: 'first' });
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite-request',
      headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'reason=second',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain('msg=err_pending_exists');
  });

  it('happy path emits invite_request_sent', async () => {
    const app = await build();
    const op = makeOperator();
    const r = await app.inject({
      method: 'POST', url: '/lobby/invite-request',
      headers: { cookie: op.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'reason=please%20one%20more&email=' + encodeURIComponent(uniqEmail('req')),
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toContain('msg=requested');
    const ev = db.prepare(`SELECT * FROM events WHERE kind='invite_request_sent' AND user_id=?`).get(op.user.id);
    expect(ev).toBeTruthy();
  });
});
