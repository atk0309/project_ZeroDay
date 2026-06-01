// Challenge 6 — dns-whispers. Verifies the simulated dig tool returns the
// flag only for the magic _secret TXT name, and NXDOMAIN otherwise.

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

describe('challenge: dns-whispers', () => {
  it('renders the dig tool with no query and no flag leak', async () => {
    const app = await build();
    const u = findOrCreateUser('dw-tool@example.com', 'dw-tool');
    skipTo(u.id, 6);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/6',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/dialup directory/);
    expect(r.body).toMatch(/no query yet/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
  });

  it('returns NXDOMAIN for unknown names', async () => {
    const app = await build();
    const u = findOrCreateUser('dw-nx@example.com', 'dw-nx');
    skipTo(u.id, 6);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/6?name=' + encodeURIComponent('does-not-exist.wopr.example.com'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/NXDOMAIN/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
  });

  it('returns flavor TXT for _motd without leaking the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('dw-motd@example.com', 'dw-motd');
    skipTo(u.id, 6);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/6?name=' + encodeURIComponent('_motd.wopr.example.com'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/winning move is not to play/);
    expect(r.body).not.toMatch(/ZERODAY\{/);
  });

  it('returns the flag in TXT for _secret.wopr.example.com', async () => {
    const app = await build();
    const u = findOrCreateUser('dw-secret@example.com', 'dw-secret');
    skipTo(u.id, 6);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/6?name=' + encodeURIComponent('_secret.wopr.example.com'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'dns-whispers'));
  });

  it('matches case-insensitively and tolerates trailing dots', async () => {
    const app = await build();
    const u = findOrCreateUser('dw-fmt@example.com', 'dw-fmt');
    skipTo(u.id, 6);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/6?name=' + encodeURIComponent('_SECRET.Wopr.Example.Com.'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'dns-whispers'));
  });
});
