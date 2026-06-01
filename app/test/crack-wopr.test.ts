// Challenge 15 — crack-wopr. Crypto, sha-256("joshua") wargames lore puzzle.
// Solve: ?login=joshua.

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { verifyPassword, PASSWORD_DIGEST } from '../src/challenges/handlers/crack-wopr.js';

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

const HUB_URL = '/c/15';
const WOPR_HOST = 'wopr.example.com';

describe('challenge: crack-wopr (pure)', () => {
  it('idle on empty / null input', () => {
    expect(verifyPassword(null).kind).toBe('idle');
    expect(verifyPassword('').kind).toBe('idle');
  });

  it('wrong on near-misses', () => {
    expect(verifyPassword('Joshua').kind).toBe('wrong');
    expect(verifyPassword('helen').kind).toBe('wrong');
    expect(verifyPassword('falken').kind).toBe('wrong');
  });

  it('ok on canonical password', () => {
    expect(verifyPassword('joshua').kind).toBe('ok');
  });

  it('published digest matches sha256("joshua")', () => {
    const expected = createHash('sha256').update('joshua', 'utf8').digest('hex');
    expect(PASSWORD_DIGEST).toBe(expected);
  });
});

describe('challenge: crack-wopr (route)', () => {
  it('GET /c/15 publishes the digest and falken-register hint, no flag', async () => {
    const app = await build();
    const u = findOrCreateUser('cw-render@example.com', 'cw-render');
    skipTo(u.id, 15);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(PASSWORD_DIGEST);
    expect(r.body).toMatch(/falken/i);
    expect(r.body).not.toContain(generateFlag(u, 'crack-wopr'));
  });

  it('?login=joshua reveals greeting and flag', async () => {
    const app = await build();
    const u = findOrCreateUser('cw-solve@example.com', 'cw-solve');
    skipTo(u.id, 15);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?login=joshua',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/GREETINGS, PROFESSOR FALKEN/);
    expect(r.body).toContain(generateFlag(u, 'crack-wopr'));
  });

  it('wrong login does not reveal flag', async () => {
    const app = await build();
    const u = findOrCreateUser('cw-wrong@example.com', 'cw-wrong');
    skipTo(u.id, 15);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?login=helen',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/identification failed/i);
    expect(r.body).not.toContain(generateFlag(u, 'crack-wopr'));
  });

  it('also works on the wopr host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('cw-host@example.com', 'cw-host');
    skipTo(u.id, 15);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/?login=joshua',
      headers: { host: WOPR_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'crack-wopr'));
  });

  it('two players: same digest, different flags', async () => {
    const app = await build();
    const a = findOrCreateUser('cw-a@example.com', 'cw-a');
    const b = findOrCreateUser('cw-b@example.com', 'cw-b');
    skipTo(a.id, 15);
    skipTo(b.id, 15);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const ra = await app.inject({ method: 'GET', url: HUB_URL + '?login=joshua', headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url: HUB_URL + '?login=joshua', headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'crack-wopr'));
    expect(rb.body).toContain(generateFlag(b, 'crack-wopr'));
    expect(ra.body).not.toContain(generateFlag(b, 'crack-wopr'));
    expect(ra.body).toContain(PASSWORD_DIGEST);
    expect(rb.body).toContain(PASSWORD_DIGEST);
  });
});
