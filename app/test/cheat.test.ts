// Anti-cheat detection: when a player submits another op's flag, the
// supplier accumulates a strike and the consumer freezes. Two strikes on
// the supplier flips them to frozen too.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { db } from '../src/db/index.js';
import { findOrCreateUser, createSession, type User } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';

beforeAll(() => {
  applySchema();
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

function skipTo(userId: number, ordinal: number) {
  for (let i = 1; i < ordinal; i++) adminSkip(userId, i);
}

function userRow(id: number): User {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User;
}

function strikesFor(supplierId: number) {
  return db.prepare(`SELECT * FROM cheat_strikes WHERE supplier_id = ? ORDER BY id`).all(supplierId) as Record<string, unknown>[];
}

function lastEvent(): Record<string, unknown> | undefined {
  return db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT 1`).get() as Record<string, unknown> | undefined;
}

describe('cheat detection — wrong-submit-then-shape-match path', () => {
  it('player B submitting player A\'s flag freezes B and strikes A', async () => {
    const app = await build();
    const a = findOrCreateUser('cheat-a@example.com', 'cheat-a');
    const b = findOrCreateUser('cheat-b@example.com', 'cheat-b');
    skipTo(a.id, 1); // both stay on ordinal 1 (white-rabbit)
    skipTo(b.id, 1);
    const sb = createSession(b.id);
    const aFlag = generateFlag(a, 'white-rabbit');

    const r = await app.inject({
      method: 'POST',
      url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.correct).toBe(false);
    expect(body.cheat).toEqual({
      detected: true,
      supplier_alias: 'cheat-a',
      strike_number: 1,
      supplier_frozen: false,
    });

    // Consumer (B) frozen
    const bRow = userRow(b.id);
    expect(bRow.frozen_at).not.toBeNull();
    expect(bRow.frozen_reason).toBe('cheat_consumer');

    // Supplier (A) struck once, NOT frozen
    const aRow = userRow(a.id);
    expect(aRow.frozen_at).toBeNull();
    expect(aRow.cheat_strikes).toBe(1);

    // Strike row exists, unack
    const strikes = strikesFor(a.id);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].consumer_id).toBe(b.id);
    expect(strikes[0].acknowledged_at).toBeNull();
    expect(strikes[0].strike_number).toBe(1);

    // Event row written
    const ev = lastEvent();
    expect(ev?.kind).toBe('cheat_detected');
    const payload = JSON.parse(String(ev?.payload ?? '{}'));
    expect(payload.supplier_alias).toBe('cheat-a');
    expect(payload.consumer_alias).toBe('cheat-b');
    expect(payload.strike_number).toBe(1);
    expect(payload.supplier_frozen).toBe(false);
  });

  it('a second strike on the same supplier (different consumer) freezes the supplier', async () => {
    const app = await build();
    const a = findOrCreateUser('cheat-a2@example.com', 'cheat-a2');
    const b = findOrCreateUser('cheat-b2@example.com', 'cheat-b2');
    const c = findOrCreateUser('cheat-c2@example.com', 'cheat-c2');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    skipTo(c.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');

    // First strike (b uses a's flag)
    const sb = createSession(b.id);
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });
    expect(userRow(a.id).cheat_strikes).toBe(1);
    expect(userRow(a.id).frozen_at).toBeNull();

    // Second strike (c uses a's flag) → supplier frozen
    const sc = createSession(c.id);
    const r2 = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sc}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });
    const body2 = JSON.parse(r2.body);
    expect(body2.cheat.strike_number).toBe(2);
    expect(body2.cheat.supplier_frozen).toBe(true);

    const aRow = userRow(a.id);
    expect(aRow.cheat_strikes).toBe(2);
    expect(aRow.frozen_at).not.toBeNull();
    expect(aRow.frozen_reason).toBe('cheat_supplier_strike2');
  });

  it('random wrong flag (correct shape but not anyone\'s) does not trigger detection', async () => {
    const app = await build();
    const u = findOrCreateUser('cheat-honest@example.com', 'cheat-honest');
    skipTo(u.id, 1);
    const sid = createSession(u.id);
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM cheat_strikes`).get() as { n: number }).n;

    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: 'ZERODAY{DEADBEEFDEADBEEFDEADBEEF}' }),
    });
    const body = JSON.parse(r.body);
    expect(body.correct).toBe(false);
    expect(body.cheat).toBeUndefined();
    expect(userRow(u.id).frozen_at).toBeNull();
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM cheat_strikes`).get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('malformed flag (wrong shape) fast-fails without scanning users', async () => {
    const app = await build();
    const u = findOrCreateUser('cheat-malformed@example.com', 'cheat-malformed');
    skipTo(u.id, 1);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: 'hello' }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.correct).toBe(false);
    expect(body.cheat).toBeUndefined();
  });
});

describe('frozen-state enforcement', () => {
  it('a frozen player\'s subsequent /api/submit returns 423', async () => {
    const app = await build();
    const a = findOrCreateUser('frz-a@example.com', 'frz-a');
    const b = findOrCreateUser('frz-b@example.com', 'frz-b');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');
    const sb = createSession(b.id);
    // First submit freezes b
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });
    // Second submit should be blocked
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: 'ZERODAY{1234567890ABCDEF12345678}' }),
    });
    expect(r.statusCode).toBe(423);
    const body = JSON.parse(r.body);
    expect(body.error).toBe('frozen');
  });

  it('a frozen player loading the hub redirects to /frozen', async () => {
    const app = await build();
    const a = findOrCreateUser('frz-hub-a@example.com', 'frz-hub-a');
    const b = findOrCreateUser('frz-hub-b@example.com', 'frz-hub-b');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');
    const sb = createSession(b.id);
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });
    const r = await app.inject({ method: 'GET', url: '/', headers: { cookie: `player_session=${sb}` } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/frozen');
  });
});

describe('supplier first-login experience hook', () => {
  it("after one strike, supplier's next hub request redirects to /strike-notice", async () => {
    const app = await build();
    const a = findOrCreateUser('sup-a@example.com', 'sup-a');
    const b = findOrCreateUser('sup-b@example.com', 'sup-b');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');
    const sb = createSession(b.id);
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });

    const sa = createSession(a.id);
    const r = await app.inject({ method: 'GET', url: '/', headers: { cookie: `player_session=${sa}` } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/strike-notice');
  });

  it("posting to /strike-notice/ack acks the strike and redirects to /", async () => {
    const app = await build();
    const a = findOrCreateUser('sup-ack-a@example.com', 'sup-ack-a');
    const b = findOrCreateUser('sup-ack-b@example.com', 'sup-ack-b');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');
    const sb = createSession(b.id);
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });

    const sa = createSession(a.id);
    const r = await app.inject({
      method: 'POST', url: '/strike-notice/ack',
      headers: { cookie: `player_session=${sa}`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/');

    // Subsequent hub request goes through (no longer redirected to strike-notice).
    const r2 = await app.inject({ method: 'GET', url: '/', headers: { cookie: `player_session=${sa}` } });
    expect(r2.statusCode).not.toBe(302);
  });

  it('json /api/* routes do not redirect to /strike-notice', async () => {
    const app = await build();
    const a = findOrCreateUser('sup-api-a@example.com', 'sup-api-a');
    const b = findOrCreateUser('sup-api-b@example.com', 'sup-api-b');
    skipTo(a.id, 1);
    skipTo(b.id, 1);
    const aFlag = generateFlag(a, 'white-rabbit');
    const sb = createSession(b.id);
    await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sb}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'white-rabbit', flag: aFlag }),
    });

    const sa = createSession(a.id);
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `player_session=${sa}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.alias).toBe('sup-api-a');
  });
});
