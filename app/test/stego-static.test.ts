// Challenge 17 — stego-static. Meta puzzle: LSB stego in a CRT-static PNG.
// Per-player payload carries flag + GIBSON key fragment 3 in the same image.

import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
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

// Reference decoder — must match the protocol in stego-static.ts and
// tools/stego-encode.py: row-major pixel walk, R/G/B (skip A), MSB-first bits,
// 16-bit big-endian length prefix.
function decodeLsb(pngBytes: Buffer): string {
  const png = PNG.sync.read(pngBytes);
  const totalPixels = png.width * png.height;
  function* bits(): Generator<number> {
    for (let p = 0; p < totalPixels; p++) {
      const base = p * 4;
      yield png.data[base] & 1;
      yield png.data[base + 1] & 1;
      yield png.data[base + 2] & 1;
    }
  }
  const it = bits();
  const takeByte = (): number => {
    let b = 0;
    for (let i = 0; i < 8; i++) b = (b << 1) | (it.next().value as number);
    return b;
  };
  const length = (takeByte() << 8) | takeByte();
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = takeByte();
  return out.toString('utf8');
}

const HUB_URL = '/c/17';
const STEGO_HOST = 'example.com';

describe('challenge: stego-static (route)', () => {
  it('landing page references the static image', async () => {
    const app = await build();
    const u = findOrCreateUser('st-land@example.com', 'st-land');
    skipTo(u.id, 17);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/static\.png/);
    expect(r.body).toMatch(/static remembers/i);
    // Landing must NOT leak the flag in plaintext — that defeats the puzzle.
    expect(r.body).not.toContain(generateFlag(u, 'stego-static'));
    expect(r.body).not.toContain(GIBSON_KEY_PARTS[3]);
  });

  it('GET /c/17/static.png returns a valid PNG', async () => {
    const app = await build();
    const u = findOrCreateUser('st-png@example.com', 'st-png');
    skipTo(u.id, 17);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/static.png',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/png/);
    // Buffer should parse as a real PNG.
    const png = PNG.sync.read(r.rawPayload);
    expect(png.width).toBe(256);
    expect(png.height).toBe(256);
  });

  it('LSB payload contains the per-player flag AND gibson key part 3', async () => {
    const app = await build();
    const u = findOrCreateUser('st-decode@example.com', 'st-decode');
    skipTo(u.id, 17);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/static.png',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const decoded = decodeLsb(r.rawPayload);
    expect(decoded).toContain(`flag=${generateFlag(u, 'stego-static')}`);
    expect(decoded).toContain(`gibson_key_part_3=${GIBSON_KEY_PARTS[3]}`);
  });

  it('also works on the example.com host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('st-host@example.com', 'st-host');
    skipTo(u.id, 17);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/static.png',
      headers: { host: STEGO_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/png/);
    const decoded = decodeLsb(r.rawPayload);
    expect(decoded).toContain(`flag=${generateFlag(u, 'stego-static')}`);
  });

  it('two players: each gets a different LSB stream but the same key fragment', async () => {
    const app = await build();
    const a = findOrCreateUser('st-a@example.com', 'st-a');
    const b = findOrCreateUser('st-b@example.com', 'st-b');
    skipTo(a.id, 17);
    skipTo(b.id, 17);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const ra = await app.inject({
      method: 'GET',
      url: HUB_URL + '/static.png',
      headers: { cookie: `player_session=${sa}` },
    });
    const rb = await app.inject({
      method: 'GET',
      url: HUB_URL + '/static.png',
      headers: { cookie: `player_session=${sb}` },
    });
    const da = decodeLsb(ra.rawPayload);
    const db = decodeLsb(rb.rawPayload);
    expect(da).toContain(generateFlag(a, 'stego-static'));
    expect(db).toContain(generateFlag(b, 'stego-static'));
    expect(da).not.toContain(generateFlag(b, 'stego-static'));
    expect(da).toContain(GIBSON_KEY_PARTS[3]);
    expect(db).toContain(GIBSON_KEY_PARTS[3]);
  });

  it('off-ordinal player cannot reach the image (gate intact)', async () => {
    const app = await build();
    const u = findOrCreateUser('st-gate@example.com', 'st-gate');
    // current_ordinal stays at 1 — they should not see #17's image.
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/static.png',
      headers: { cookie: `player_session=${sid}` },
    });
    // The /c/:ordinal dispatcher returns 403 + locked.ejs for ordinals above
    // current. Asserting non-200 + non-image is enough to catch a regression
    // that would silently serve the per-player payload.
    expect(r.statusCode).not.toBe(200);
    expect(r.headers['content-type']).not.toMatch(/image\/png/);
  });
});
