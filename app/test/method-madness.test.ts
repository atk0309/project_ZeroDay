// Challenge 10 — method-madness. Host-routed on wopr.example.com. The puzzle
// keys off the HTTP verb: GET shows the landing, OPTIONS discloses Allow,
// PATCH yields the flag, anything else is 405.

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

const HOST = 'wopr.example.com';

describe('challenge: method-madness', () => {
  it('GET / on wopr host renders the console-ii landing without leaking the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('mm-get@example.com', 'mm-get');
    skipTo(u.id, 10);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/console ii/i);
    expect(r.body).not.toContain(generateFlag(u, 'method-madness'));
  });

  it('GET /c/10 from the hub also renders the landing (canonical entry)', async () => {
    const app = await build();
    const u = findOrCreateUser('mm-hub@example.com', 'mm-hub');
    skipTo(u.id, 10);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/10',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/console ii/i);
    expect(r.body).not.toContain(generateFlag(u, 'method-madness'));
  });

  it('OPTIONS / responds 204 with Allow listing GET, OPTIONS, PATCH', async () => {
    const app = await build();
    const u = findOrCreateUser('mm-opt@example.com', 'mm-opt');
    skipTo(u.id, 10);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(204);
    const allow = (r.headers['allow'] ?? '') as string;
    expect(allow.split(/\s*,\s*/).sort()).toEqual(['GET', 'HEAD', 'OPTIONS', 'PATCH']);
    expect(r.body).not.toContain(generateFlag(u, 'method-madness'));
  });

  it('PATCH / serves 200 with the flag in body and X-Wopr-Patch header', async () => {
    const app = await build();
    const u = findOrCreateUser('mm-patch@example.com', 'mm-patch');
    skipTo(u.id, 10);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'PATCH',
      url: '/',
      headers: { host: HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const flag = generateFlag(u, 'method-madness');
    expect(r.body).toContain(flag);
    expect(r.headers['x-wopr-patch']).toBe(flag);
  });

  it('rejects POST/PUT/DELETE with 405 and an Allow header', async () => {
    const app = await build();
    const u = findOrCreateUser('mm-405@example.com', 'mm-405');
    skipTo(u.id, 10);
    const sid = createSession(u.id);

    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const r = await app.inject({
        method,
        url: '/',
        headers: { host: HOST, cookie: `player_session=${sid}` },
      });
      expect(r.statusCode).toBe(405);
      const allow = (r.headers['allow'] ?? '') as string;
      expect(allow.split(/\s*,\s*/).sort()).toEqual(['GET', 'HEAD', 'OPTIONS', 'PATCH']);
      expect(r.body).not.toContain(generateFlag(u, 'method-madness'));
    }
  });

  it('per-player flag: two different players get two different PATCH responses', async () => {
    const app = await build();
    const a = findOrCreateUser('mm-a@example.com', 'mm-a');
    const b = findOrCreateUser('mm-b@example.com', 'mm-b');
    skipTo(a.id, 10);
    skipTo(b.id, 10);
    const sa = createSession(a.id);
    const sb = createSession(b.id);

    const ra = await app.inject({ method: 'PATCH', url: '/', headers: { host: HOST, cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'PATCH', url: '/', headers: { host: HOST, cookie: `player_session=${sb}` } });
    expect(ra.headers['x-wopr-patch']).toBe(generateFlag(a, 'method-madness'));
    expect(rb.headers['x-wopr-patch']).toBe(generateFlag(b, 'method-madness'));
    expect(ra.headers['x-wopr-patch']).not.toBe(rb.headers['x-wopr-patch']);
  });
});
