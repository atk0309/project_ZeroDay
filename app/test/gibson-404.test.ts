// Challenge 8 — gibson-404. Host-routed on gibson.example.com. Most paths
// return a styled 404 with a base64 hint comment; /robots.txt lists two
// paths; /sys/console serves the flag.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
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

const HOST = 'gibson.example.com';

describe('challenge: gibson-404', () => {
  it('GET / on gibson host returns 404 page with a base64 hint comment, no flag in body', async () => {
    const app = await build();
    const u = findOrCreateUser('g404-root@example.com', 'g404-root');
    skipTo(u.id, 8);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain(generateFlag(u, 'gibson-404'));
    const m = r.body.match(/<!--\s*([A-Za-z0-9+/=]+)\s*-->/);
    expect(m).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(m![1], 'base64').toString('utf8'));
    expect(decoded.hint).toMatch(/robots/i);
  });

  it('GET /robots.txt lists both the decoy and the real path', async () => {
    const app = await build();
    const u = findOrCreateUser('g404-robots@example.com', 'g404-robots');
    skipTo(u.id, 8);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/Disallow: \/sys\/diag/);
    expect(r.body).toMatch(/Disallow: \/sys\/console/);
  });

  it('GET /sys/diag returns a decoy 404 with no flag', async () => {
    const app = await build();
    const u = findOrCreateUser('g404-decoy@example.com', 'g404-decoy');
    skipTo(u.id, 8);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/sys/diag',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain(generateFlag(u, 'gibson-404'));
    expect(r.body).toMatch(/keep digging/);
  });

  it('GET /sys/console serves 200 with the flag in body and X-Gibson-Bypass header', async () => {
    const app = await build();
    const u = findOrCreateUser('g404-real@example.com', 'g404-real');
    skipTo(u.id, 8);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/sys/console',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const flag = generateFlag(u, 'gibson-404');
    expect(r.body).toContain(flag);
    expect(r.headers['x-gibson-bypass']).toBe(flag);
  });
});
