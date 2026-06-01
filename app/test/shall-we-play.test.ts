// Challenge 14 — shall-we-play. Logic, wopr-themed wargames lore puzzle.
// Solve: ?game=global-thermonuclear-war&move=cease.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { evaluateMove } from '../src/challenges/handlers/shall-we-play.js';

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

const HUB_URL = '/c/14';
const WOPR_HOST = 'wopr.example.com';
const SOLVE_QS = '?game=global-thermonuclear-war&move=cease';

describe('challenge: shall-we-play (pure)', () => {
  it('no game → menu', () => {
    expect(evaluateMove(null, null).kind).toBe('menu');
    expect(evaluateMove('', null).kind).toBe('menu');
  });

  it('unknown game → menu', () => {
    expect(evaluateMove('go-fish', null).kind).toBe('menu');
  });

  it('non-gtnw game → game-selected', () => {
    expect(evaluateMove('chess', null).kind).toBe('game-selected');
  });

  it('gtnw with no move → gtnw-selected', () => {
    expect(evaluateMove('global-thermonuclear-war', null).kind).toBe('gtnw-selected');
  });

  it('any selected game + play → dead-end', () => {
    expect(evaluateMove('chess', 'play').kind).toBe('dead-end');
    expect(evaluateMove('global-thermonuclear-war', 'play').kind).toBe('dead-end');
  });

  it('gtnw + cease → solved', () => {
    expect(evaluateMove('global-thermonuclear-war', 'cease').kind).toBe('solved');
  });

  it('non-gtnw + cease → dead-end (cease only refuses war)', () => {
    expect(evaluateMove('chess', 'cease').kind).toBe('dead-end');
  });
});

describe('challenge: shall-we-play (route)', () => {
  it('GET /c/14 with no params renders the menu, no flag', async () => {
    const app = await build();
    const u = findOrCreateUser('swp-render@example.com', 'swp-render');
    skipTo(u.id, 14);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/shall we play/i);
    expect(r.body).toMatch(/global thermonuclear war/i);
    expect(r.body).not.toContain(generateFlag(u, 'shall-we-play'));
  });

  it('selecting gtnw surfaces the "the only winning move" reasoning', async () => {
    const app = await build();
    const u = findOrCreateUser('swp-gtnw@example.com', 'swp-gtnw');
    skipTo(u.id, 14);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?game=global-thermonuclear-war',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/the only winning move is not to play/i);
    expect(r.body).not.toContain(generateFlag(u, 'shall-we-play'));
  });

  it('cease on gtnw reveals the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('swp-solve@example.com', 'swp-solve');
    skipTo(u.id, 14);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + SOLVE_QS,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'shall-we-play'));
  });

  it('play on gtnw is a dead-end with no flag', async () => {
    const app = await build();
    const u = findOrCreateUser('swp-play@example.com', 'swp-play');
    skipTo(u.id, 14);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?game=global-thermonuclear-war&move=play',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/carrier engaged/i);
    expect(r.body).not.toContain(generateFlag(u, 'shall-we-play'));
  });

  it('also works on the wopr host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('swp-host@example.com', 'swp-host');
    skipTo(u.id, 14);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/' + SOLVE_QS,
      headers: { host: WOPR_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'shall-we-play'));
  });

  it('two players: each gets their own flag, not the other\'s', async () => {
    const app = await build();
    const a = findOrCreateUser('swp-a@example.com', 'swp-a');
    const b = findOrCreateUser('swp-b@example.com', 'swp-b');
    skipTo(a.id, 14);
    skipTo(b.id, 14);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const ra = await app.inject({ method: 'GET', url: HUB_URL + SOLVE_QS, headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url: HUB_URL + SOLVE_QS, headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'shall-we-play'));
    expect(rb.body).toContain(generateFlag(b, 'shall-we-play'));
    expect(ra.body).not.toContain(generateFlag(b, 'shall-we-play'));
  });
});
