// Challenge 9 — client-cinema. CSS animation reveals the flag for one frame.
// The flag is server-injected into a data-flag attribute on the canvas; the
// JS reads it and paints into the canvas, while CSS keyframes flash it
// visible at ~99% of the cycle.

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

describe('challenge: client-cinema', () => {
  it('renders a canvas reveal page with the X-Cinema-Hint header', async () => {
    const app = await build();
    const u = findOrCreateUser('cc-render@example.com', 'cc-render');
    skipTo(u.id, 9);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/9',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-cinema-hint']).toBe('pause-on-frame');
    expect(r.body).toMatch(/canvas/);
    expect(r.body).toMatch(/@keyframes reveal/);
  });

  it('flag is reachable to a player who inspects the canvas data-flag attribute', async () => {
    const app = await build();
    const u = findOrCreateUser('cc-inspect@example.com', 'cc-inspect');
    skipTo(u.id, 9);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/9',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    // The flag is injected as a data attribute the canvas reads; this is the
    // intended retrieval path (DevTools / view-source).
    expect(r.body).toContain(generateFlag(u, 'client-cinema'));
    expect(r.body).toMatch(/data-flag="ZERODAY\{[A-F0-9]{24}\}"/);
  });

  it('two different players get two different flags injected', async () => {
    const app = await build();
    const a = findOrCreateUser('cc-a@example.com', 'cc-a');
    const b = findOrCreateUser('cc-b@example.com', 'cc-b');
    skipTo(a.id, 9);
    skipTo(b.id, 9);
    const sa = createSession(a.id);
    const sb = createSession(b.id);

    const ra = await app.inject({ method: 'GET', url: '/c/9', headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url: '/c/9', headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'client-cinema'));
    expect(rb.body).toContain(generateFlag(b, 'client-cinema'));
    expect(ra.body).not.toContain(generateFlag(b, 'client-cinema'));
    expect(rb.body).not.toContain(generateFlag(a, 'client-cinema'));
  });
});
