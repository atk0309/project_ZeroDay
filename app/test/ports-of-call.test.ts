// Challenge 13 — ports-of-call. Net puzzle, port-knocking analog.
// Player must dial 2600,8128,31337 in order. Solve reveals the per-player flag
// AND GIBSON key fragment 2.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { GIBSON_KEY_PARTS } from '../src/lib/gibson.js';
import { evaluateDial } from '../src/challenges/handlers/ports-of-call.js';

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

const HUB_URL = '/c/13';
const WOPR_HOST = 'wopr.example.com';

describe('challenge: ports-of-call (pure)', () => {
  it('idle on empty input', () => {
    expect(evaluateDial('').kind).toBe('idle');
    expect(evaluateDial(null).kind).toBe('idle');
  });

  it('canonical sequence is ok', () => {
    expect(evaluateDial('2600,8128,31337').kind).toBe('ok');
  });

  it('wrong order is wrong', () => {
    const r = evaluateDial('8128,2600,31337');
    expect(r.kind).toBe('wrong');
  });

  it('subset / extra entries are wrong', () => {
    expect(evaluateDial('2600,8128').kind).toBe('wrong');
    expect(evaluateDial('2600,8128,31337,42').kind).toBe('wrong');
  });

  it('non-digit entries return malformed', () => {
    expect(evaluateDial('abc,2600,8128').kind).toBe('malformed');
    expect(evaluateDial('2600,,8128').kind).toBe('malformed');
  });
});

describe('challenge: ports-of-call (route)', () => {
  it('GET /c/13 with no dial renders the three line clues, no leak', async () => {
    const app = await build();
    const u = findOrCreateUser('po-render@example.com', 'po-render');
    skipTo(u.id, 13);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/switchboard/i);
    expect(r.body).toMatch(/cereal box whistle/i);
    expect(r.body).toMatch(/perfect number/i);
    expect(r.body).not.toContain(generateFlag(u, 'ports-of-call'));
    expect(r.body).not.toContain(GIBSON_KEY_PARTS[2]);
  });

  it('correct dial reveals flag + GIBSON key part 2', async () => {
    const app = await build();
    const u = findOrCreateUser('po-solve@example.com', 'po-solve');
    skipTo(u.id, 13);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?dial=' + encodeURIComponent('2600,8128,31337'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'ports-of-call'));
    expect(r.body).toContain(GIBSON_KEY_PARTS[2]);
  });

  it('wrong-order dial does not reveal flag or key part', async () => {
    const app = await build();
    const u = findOrCreateUser('po-wrong@example.com', 'po-wrong');
    skipTo(u.id, 13);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?dial=' + encodeURIComponent('8128,2600,31337'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(generateFlag(u, 'ports-of-call'));
    expect(r.body).not.toContain(GIBSON_KEY_PARTS[2]);
    expect(r.body).toMatch(/carrier dropped/i);
  });

  it('also works on the wopr host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('po-host@example.com', 'po-host');
    skipTo(u.id, 13);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/?dial=' + encodeURIComponent('2600,8128,31337'),
      headers: { host: WOPR_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'ports-of-call'));
    expect(r.body).toContain(GIBSON_KEY_PARTS[2]);
  });

  it('two players: per-player flag differs but key fragment 2 is identical', async () => {
    const app = await build();
    const a = findOrCreateUser('po-a@example.com', 'po-a');
    const b = findOrCreateUser('po-b@example.com', 'po-b');
    skipTo(a.id, 13);
    skipTo(b.id, 13);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const url = HUB_URL + '?dial=' + encodeURIComponent('2600,8128,31337');
    const ra = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'ports-of-call'));
    expect(rb.body).toContain(generateFlag(b, 'ports-of-call'));
    expect(ra.body).not.toContain(generateFlag(b, 'ports-of-call'));
    expect(ra.body).toContain(GIBSON_KEY_PARTS[2]);
    expect(rb.body).toContain(GIBSON_KEY_PARTS[2]);
  });
});
