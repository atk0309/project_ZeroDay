// Regression: /c/:ordinal/* must dispatch to the challenge handler with the
// puzzle-relative URL. Without the wildcard route on the hub, players who
// follow challenge 1's "/matrix" breadcrumb on a single-host deploy (staging,
// or any setup where the per-challenge subdomain isn't wired in DNS) hit a
// raw Fastify 404. The wildcard route rewrites req.url so handlers see the
// same shape as the host-routed dispatch in server.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { generateFlag } from '../src/lib/flags.js';

beforeAll(() => {
  applySchema();
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

describe('hub /c/:ordinal/* subpath dispatch', () => {
  it('GET /c/1/matrix from the hub returns the matrix page with the player flag', async () => {
    const app = await build();
    const u = findOrCreateUser('rabbit-hub@example.com', 'rabbit-hub');
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/1/matrix',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/the matrix has you/i);
    expect(r.body).toContain(generateFlag(u, 'white-rabbit'));
  });

  it('GET /c/1/robots.txt from the hub returns the disallow breadcrumb', async () => {
    const app = await build();
    const u = findOrCreateUser('rabbit-robots@example.com', 'rabbit-robots');
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/1/robots.txt',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/Disallow:\s*\/matrix/);
  });

  it('GET /c/2/matrix is locked for a player who is still on ordinal 1 (no leak)', async () => {
    const app = await build();
    const u = findOrCreateUser('rabbit-locked@example.com', 'rabbit-locked');
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/2/matrix',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatch(/PRIOR CLEARANCE/i);
  });
});
