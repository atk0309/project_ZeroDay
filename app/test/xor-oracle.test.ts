// Challenge 12 — xor-oracle. Repeating-key XOR with a known plaintext prefix.
// Verifies the rendered hex blob does NOT contain the plaintext flag, and that
// XORing the first 13 bytes against `flag=ZERODAY{` recovers the 11-byte key
// which then decrypts the entire blob to the per-player flag.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { xorRepeating, buildBlobHex } from '../src/challenges/handlers/xor-oracle.js';

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

function extractBlob(html: string): string {
  const m = html.match(/<code class="blob">([0-9A-F]+)<\/code>/);
  if (!m) throw new Error('blob not rendered');
  return m[1]!;
}

// Emulate the player's known-plaintext attack: take the first N bytes of
// ciphertext, XOR with the known prefix to recover the repeating key, then
// XOR the whole ciphertext to read the cleartext.
function knownPlaintextAttack(blobHex: string, knownPrefix: string): string {
  const cipher = Buffer.from(blobHex, 'hex');
  const prefix = Buffer.from(knownPrefix, 'utf8');
  const keyLen = prefix.length - 2; // any number < prefix.length works; for our 11-byte key, < 13
  const key = Buffer.alloc(keyLen);
  for (let i = 0; i < keyLen; i++) key[i] = cipher[i]! ^ prefix[i]!;
  return xorRepeating(cipher, key.toString('utf8')).toString('utf8');
}

describe('challenge: xor-oracle (pure)', () => {
  it('buildBlobHex is reversible with a known-plaintext attack on the prefix', () => {
    const flag = 'ZERODAY{ABCDEF0123456789ABCD}';
    const hex = buildBlobHex(flag);
    const recovered = knownPlaintextAttack(hex, 'flag=ZERODAY{');
    expect(recovered).toContain(`flag=${flag}`);
  });

  it('blob is even-length hex (uppercase)', () => {
    const hex = buildBlobHex('ZERODAY{000000000000000000000000}');
    expect(hex.length % 2).toBe(0);
    expect(hex).toMatch(/^[0-9A-F]+$/);
  });

  it('repeated calls are deterministic for a given flag', () => {
    const flag = 'ZERODAY{0011223344556677889900AA}';
    expect(buildBlobHex(flag)).toBe(buildBlobHex(flag));
  });
});

describe('challenge: xor-oracle (route)', () => {
  it('GET /c/12 renders a hex blob and does NOT leak the plaintext flag', async () => {
    const app = await build();
    const u = findOrCreateUser('xo-render@example.com', 'xo-render');
    skipTo(u.id, 12);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/c/12',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const flag = generateFlag(u, 'xor-oracle');
    expect(r.body).not.toContain(flag);
    const blob = extractBlob(r.body);
    expect(blob.length).toBeGreaterThan(0);
  });

  it('the rendered blob, attacked via known prefix, decrypts to the per-player flag', async () => {
    const app = await build();
    const u = findOrCreateUser('xo-solve@example.com', 'xo-solve');
    skipTo(u.id, 12);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/c/12',
      headers: { cookie: `player_session=${sid}` },
    });
    const blob = extractBlob(r.body);
    const cleartext = knownPlaintextAttack(blob, 'flag=ZERODAY{');
    expect(cleartext).toContain(`flag=${generateFlag(u, 'xor-oracle')}`);
  });

  it('two players get two different blobs', async () => {
    const app = await build();
    const a = findOrCreateUser('xo-a@example.com', 'xo-a');
    const b = findOrCreateUser('xo-b@example.com', 'xo-b');
    skipTo(a.id, 12);
    skipTo(b.id, 12);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const ra = await app.inject({ method: 'GET', url: '/c/12', headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url: '/c/12', headers: { cookie: `player_session=${sb}` } });
    expect(extractBlob(ra.body)).not.toBe(extractBlob(rb.body));
  });
});
