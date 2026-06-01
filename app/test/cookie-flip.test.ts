// Challenge 4 — cookie-flip. Verifies the admin-cookie gate around the flag.

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

describe('challenge: cookie-flip', () => {
  it('denies access and sets the bait cookie when no session cookie is present', async () => {
    const app = await build();
    const u = findOrCreateUser('cf-bait@example.com', 'cf-bait');
    skipTo(u.id, 4);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/4',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/access denied/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
    // Bait cookie laid for the player.
    const setCookie = r.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(cookieHeader).toMatch(/session=/);
  });

  it('reveals the flag only when the admin cookie is true', async () => {
    const app = await build();
    const u = findOrCreateUser('cf-admin@example.com', 'cf-admin');
    skipTo(u.id, 4);
    const sid = createSession(u.id);

    const adminCookie = Buffer.from(JSON.stringify({ user: 'guest', admin: true })).toString('base64');
    const r = await app.inject({
      method: 'GET',
      url: '/c/4',
      headers: { cookie: `player_session=${sid}; session=${adminCookie}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/ACCESS GRANTED/);
    expect(r.body).toContain(generateFlag(u, 'cookie-flip'));
  });

  it("stays denied when admin is false", async () => {
    const app = await build();
    const u = findOrCreateUser('cf-guest@example.com', 'cf-guest');
    skipTo(u.id, 4);
    const sid = createSession(u.id);

    const guestCookie = Buffer.from(JSON.stringify({ user: 'guest', admin: false })).toString('base64');
    const r = await app.inject({
      method: 'GET',
      url: '/c/4',
      headers: { cookie: `player_session=${sid}; session=${guestCookie}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/access denied/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
  });
});
