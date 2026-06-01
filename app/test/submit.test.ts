// End-to-end-ish: build the full app and submit flags via inject().
// Verifies the unlock guard at the route boundary, not just lib/progress.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';
import { createSession } from '../src/lib/playerAuth.js';
import { generateFlag } from '../src/lib/flags.js';

beforeAll(() => {
  applySchema();
  // Configure phase = live so submit isn't 423'd.
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

describe('POST /api/submit', () => {
  it('returns 423 when phase is not live', async () => {
    settings.set('launch_at', new Date(Date.now() + 86400_000).toISOString()); // future
    const app = await build();
    const u = findOrCreateUser('s1@example.com', 's-one');
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sid}`, 'content-type': 'application/json' },
      payload: { challenge_id: 'white-rabbit', flag: generateFlag(u, 'white-rabbit') },
    });
    expect(r.statusCode).toBe(423);
    settings.set('launch_at', new Date(Date.now() - 86400_000).toISOString());
  });

  it('rejects submits for the wrong ordinal with 403', async () => {
    const app = await build();
    const u = findOrCreateUser('s2@example.com', 's-two');
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sid}`, 'content-type': 'application/json' },
      payload: { challenge_id: 'headers', flag: generateFlag(u, 'headers') }, // ordinal 5, but user is at 1
    });
    expect(r.statusCode).toBe(403);
    expect((await r.json()).current).toBe(1);
  });

  it('accepts the correct flag at the current ordinal and advances', async () => {
    const app = await build();
    const u = findOrCreateUser('s3@example.com', 's-three');
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sid}`, 'content-type': 'application/json' },
      payload: { challenge_id: 'white-rabbit', flag: generateFlag(u, 'white-rabbit') },
    });
    expect(r.statusCode).toBe(200);
    const data = await r.json();
    expect(data.correct).toBe(true);
    expect(data.advanced).toBe(true);
    expect(data.next).toBe(2);
  });

  it("rejects another player's flag", async () => {
    const app = await build();
    const a = findOrCreateUser('iso-1@example.com', 'iso-1');
    const b = findOrCreateUser('iso-2@example.com', 'iso-2');
    const sidB = createSession(b.id);
    // Submit user A's flag for white-rabbit while logged in as B.
    const r = await app.inject({
      method: 'POST', url: '/api/submit',
      headers: { cookie: `player_session=${sidB}`, 'content-type': 'application/json' },
      payload: { challenge_id: 'white-rabbit', flag: generateFlag(a, 'white-rabbit') },
    });
    expect(r.statusCode).toBe(200);
    expect((await r.json()).correct).toBe(false);
  });
});
