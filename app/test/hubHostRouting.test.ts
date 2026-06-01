// Regression: GET / on the canonical hub host must reach hubRoutes, even
// though that host is also a challenge subdomain (no-spoon, #2). Without
// the special-case in server.ts:onRequest, pre-stage-2 players would hit
// the locked screen on every login.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';

beforeAll(() => {
  applySchema();
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

describe('hub host root routing', () => {
  it('GET / on hack.example.com reaches hubRoutes for an authed player at ordinal 1 (no lock screen)', async () => {
    const app = await build();
    const u = findOrCreateUser('hub-host@example.com', 'hub-host');
    const sid = createSession(u.id);
    // Player is at ordinal 1 (white-rabbit). no-spoon (#2, hosted on
    // hack.example.com) is locked for them.
    const r = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'hack.example.com', cookie: `player_session=${sid}` },
    });
    // Hub root either renders the lobby/hub or redirects to /recruit/etc.
    // Either way it must NOT show the locked.ejs view (PRIOR CLEARANCE
    // REQUIRED), which is what would happen if the dispatcher routed to
    // no-spoon for a stage-1 player.
    expect(r.body).not.toMatch(/PRIOR CLEARANCE/i);
    // And the response must be from a hub handler — 200 or 302 to a hub
    // route, not 403.
    expect(r.statusCode).not.toBe(403);
  });

  it('GET / on a challenge subdomain (gibson.example.com) is still routed by the dispatcher', async () => {
    const app = await build();
    const u = findOrCreateUser('hub-host-gibson@example.com', 'hub-host-gibson');
    const sid = createSession(u.id);
    // Player at ordinal 1 hits gibson root → dispatcher matches gibson-404
    // (#8) → since they're not at ordinal 8, locked.
    const r = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'gibson.example.com', cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatch(/PRIOR CLEARANCE/i);
  });
});
