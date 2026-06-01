// Challenge 5 — headers. Verifies the User-Agent gate around the flag.

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

describe('challenge: headers', () => {
  it('denies and emits a hint header on a vanilla request', async () => {
    const app = await build();
    const u = findOrCreateUser('h-deny@example.com', 'h-deny');
    skipTo(u.id, 5);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/5',
      headers: { cookie: `player_session=${sid}`, 'user-agent': 'Mozilla/5.0 (vanilla)' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/i don't know you/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
    expect(r.headers['x-gibson-hint']).toBeDefined();
    expect(r.headers['x-gibson-access']).toBeUndefined();
  });

  it('grants and emits the flag in body + X-Gibson-Access when User-Agent contains acid-burn', async () => {
    const app = await build();
    const u = findOrCreateUser('h-grant@example.com', 'h-grant');
    skipTo(u.id, 5);
    const sid = createSession(u.id);
    const expected = generateFlag(u, 'headers');

    const r = await app.inject({
      method: 'GET',
      url: '/c/5',
      headers: { cookie: `player_session=${sid}`, 'user-agent': 'curl/8.0 acid-burn/1.0' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(expected);
    expect(r.headers['x-gibson-access']).toBe(expected);
  });

  it('matches case-insensitively', async () => {
    const app = await build();
    const u = findOrCreateUser('h-case@example.com', 'h-case');
    skipTo(u.id, 5);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/5',
      headers: { cookie: `player_session=${sid}`, 'user-agent': 'ACID-BURN' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'headers'));
  });
});
