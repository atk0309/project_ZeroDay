// Challenge 7 — matryoshka. Verifies the four-layer encoding decodes to the
// expected per-player flag + GIBSON key fragment 1.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { GIBSON_KEY_PARTS } from '../src/lib/gibson.js';

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

function unwrap(blob: string): string {
  const step1 = Buffer.from(blob, 'base64').toString('utf8');
  const step2 = Array.from(step1).reverse().join('');
  const step3 = step2.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  const step4 = Buffer.from(step3, 'base64').toString('utf8');
  return step4;
}

describe('challenge: matryoshka', () => {
  it('serves a wrapped blob that does not leak the flag in plaintext', async () => {
    const app = await build();
    const u = findOrCreateUser('mtr-render@example.com', 'mtr-render');
    skipTo(u.id, 7);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/7',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(generateFlag(u, 'matryoshka'));
    expect(r.body).not.toContain(GIBSON_KEY_PARTS[1]);
    expect(r.body).toMatch(/four veils/);
  });

  it('the rendered blob unwraps via b64 → reverse → rot13 → b64 to the per-player flag + key fragment', async () => {
    const app = await build();
    const u = findOrCreateUser('mtr-decode@example.com', 'mtr-decode');
    skipTo(u.id, 7);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/c/7',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const m = r.body.match(/<code class="blob">([A-Za-z0-9+/=]+)<\/code>/);
    expect(m).not.toBeNull();
    const blob = m![1];

    const cleartext = unwrap(blob);
    expect(cleartext).toContain(`flag=${generateFlag(u, 'matryoshka')}`);
    expect(cleartext).toContain(`gibson_key_part_1=${GIBSON_KEY_PARTS[1]}`);
  });

  it('two different players get two different blobs (per-player flag preserved)', async () => {
    const app = await build();
    const a = findOrCreateUser('mtr-a@example.com', 'mtr-a');
    const b = findOrCreateUser('mtr-b@example.com', 'mtr-b');
    skipTo(a.id, 7);
    skipTo(b.id, 7);
    const sa = createSession(a.id);
    const sb = createSession(b.id);

    const ra = await app.inject({ method: 'GET', url: '/c/7', headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url: '/c/7', headers: { cookie: `player_session=${sb}` } });

    const blobA = ra.body.match(/<code class="blob">([A-Za-z0-9+/=]+)<\/code>/)![1];
    const blobB = rb.body.match(/<code class="blob">([A-Za-z0-9+/=]+)<\/code>/)![1];
    expect(blobA).not.toBe(blobB);
    expect(unwrap(blobA)).toContain(generateFlag(a, 'matryoshka'));
    expect(unwrap(blobB)).toContain(generateFlag(b, 'matryoshka'));
  });
});
