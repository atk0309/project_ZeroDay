// Challenge 19 — hack-the-planet. Final boss on gibson.example.com.
// Player pastes the three GIBSON key fragments (collected from #7/#13/#17)
// into a console form. Server validates per-fragment, decrypts a per-player
// AES-192-CBC ciphertext, renders the diegetic plaintext containing the flag.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { GIBSON_KEY_PARTS } from '../src/lib/gibson.js';
import {
  decryptForUser,
  encryptForUser,
  gibsonIv,
  validateFragments,
} from '../src/challenges/handlers/hack-the-planet.js';

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

const HUB_URL = '/c/19';
const GIBSON_HOST = 'gibson.example.com';
const K1 = GIBSON_KEY_PARTS[1];
const K2 = GIBSON_KEY_PARTS[2];
const K3 = GIBSON_KEY_PARTS[3];

describe('challenge: hack-the-planet (pure)', () => {
  it('validateFragments: all-correct is ok', () => {
    expect(validateFragments(K1, K2, K3)).toEqual({ kind: 'ok', wrongFragments: [] });
  });

  it('validateFragments: case + whitespace tolerant', () => {
    expect(validateFragments(K1.toLowerCase(), `  ${K2}  `, K3).kind).toBe('ok');
  });

  it('validateFragments: each wrong slot reported', () => {
    expect(validateFragments('00'.repeat(8), K2, K3).wrongFragments).toEqual([1]);
    expect(validateFragments(K1, '00'.repeat(8), K3).wrongFragments).toEqual([2]);
    expect(validateFragments(K1, K2, '00'.repeat(8)).wrongFragments).toEqual([3]);
  });

  it('validateFragments: empty is wrong, all wrong reports all', () => {
    expect(validateFragments('', '', '').wrongFragments).toEqual([1, 2, 3]);
    expect(validateFragments('xx', 'yy', 'zz').wrongFragments).toEqual([1, 2, 3]);
  });

  it('decryptForUser: round-trips with correct fragments', () => {
    const user = { alias: 'crash-override', flag_salt: 'salt-a' };
    const flag = generateFlag(user as never, 'hack-the-planet');
    const iv = gibsonIv(user);
    const ct = encryptForUser(user, flag);
    const pt = decryptForUser(user, ct, iv, K1, K2, K3);
    expect(pt).not.toBeNull();
    expect(pt).toContain(flag);
    expect(pt).toContain('welcome to the collective, crash-override');
  });

  it('decryptForUser: returns null on any wrong fragment', () => {
    const user = { alias: 'acid-burn', flag_salt: 'salt-b' };
    const flag = generateFlag(user as never, 'hack-the-planet');
    const iv = gibsonIv(user);
    const ct = encryptForUser(user, flag);
    expect(decryptForUser(user, ct, iv, '00'.repeat(8), K2, K3)).toBeNull();
    expect(decryptForUser(user, ct, iv, K1, '00'.repeat(8), K3)).toBeNull();
    expect(decryptForUser(user, ct, iv, K1, K2, '00'.repeat(8))).toBeNull();
  });

  it('per-user IV: different flag_salt yields different ciphertexts for same flag content', () => {
    const a = { alias: 'a', flag_salt: 'salt-1' };
    const b = { alias: 'a', flag_salt: 'salt-2' };
    const flag = 'ZERODAY{ABCDEF0123456789ABCDEF01}';
    expect(encryptForUser(a, flag).toString('hex')).not.toBe(encryptForUser(b, flag).toString('hex'));
  });
});

describe('challenge: hack-the-planet (route)', () => {
  it('GET /c/19 with no fragments renders the console, no leak', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-render@example.com', 'htp-render');
    skipTo(u.id, 19);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/login console/i);
    expect(r.body).toMatch(/AES-192-CBC/);
    expect(r.body).toMatch(/key fragment 1/i);
    expect(r.body).toMatch(/key fragment 2/i);
    expect(r.body).toMatch(/key fragment 3/i);
    expect(r.body).not.toContain(generateFlag(u, 'hack-the-planet'));
    expect(r.body).not.toMatch(/access granted/i);
  });

  it('correct fragments reveal flag + welcome line', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-solve@example.com', 'htp-solve');
    skipTo(u.id, 19);
    const sid = createSession(u.id);
    const url = `${HUB_URL}?k1=${K1}&k2=${K2}&k3=${K3}`;
    const r = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/access granted/i);
    expect(r.body).toContain(generateFlag(u, 'hack-the-planet'));
    expect(r.body).toContain('welcome to the collective, htp-solve');
  });

  it('one wrong fragment: no flag, "key fragment N rejected" surfaced, wrong field blanked', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-wrong@example.com', 'htp-wrong');
    skipTo(u.id, 19);
    const sid = createSession(u.id);
    const wrong = '0123456789ABCDEF';
    const url = `${HUB_URL}?k1=${K1}&k2=${wrong}&k3=${K3}`;
    const r = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(generateFlag(u, 'hack-the-planet'));
    expect(r.body).not.toMatch(/access granted/i);
    expect(r.body).toMatch(/key fragment 2 rejected/i);
    // The right fragments stay pre-filled; the wrong one is blanked.
    expect(r.body).toContain(`value="${K1}"`);
    expect(r.body).toContain(`value="${K3}"`);
    expect(r.body).not.toContain(`value="${wrong}"`);
  });

  it('also works on the gibson host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-host@example.com', 'htp-host');
    skipTo(u.id, 19);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: `/?k1=${K1}&k2=${K2}&k3=${K3}`,
      headers: { host: GIBSON_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/access granted/i);
    expect(r.body).toContain(generateFlag(u, 'hack-the-planet'));
  });

  it('two players: distinct flags + ciphertexts; both decrypt with the same fragments', async () => {
    const app = await build();
    const a = findOrCreateUser('htp-a@example.com', 'htp-a');
    const b = findOrCreateUser('htp-b@example.com', 'htp-b');
    skipTo(a.id, 19);
    skipTo(b.id, 19);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const idle = await app.inject({ method: 'GET', url: HUB_URL, headers: { cookie: `player_session=${sa}` } });
    const idleB = await app.inject({ method: 'GET', url: HUB_URL, headers: { cookie: `player_session=${sb}` } });
    // Pull the rendered ciphertext blocks; they must differ (different IVs).
    const ctA = idle.body.match(/<pre class="ciphertext">([^<]+)<\/pre>/)?.[1];
    const ctB = idleB.body.match(/<pre class="ciphertext">([^<]+)<\/pre>/)?.[1];
    expect(ctA && ctB).toBeTruthy();
    expect(ctA).not.toBe(ctB);

    const url = `${HUB_URL}?k1=${K1}&k2=${K2}&k3=${K3}`;
    const ra = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'hack-the-planet'));
    expect(rb.body).toContain(generateFlag(b, 'hack-the-planet'));
    expect(ra.body).not.toContain(generateFlag(b, 'hack-the-planet'));
    expect(rb.body).not.toContain(generateFlag(a, 'hack-the-planet'));
  });

  it('off-ordinal player cannot reach the console', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-locked@example.com', 'htp-locked');
    skipTo(u.id, 5); // current_ordinal = 5, well below 19
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain(generateFlag(u, 'hack-the-planet'));
    expect(r.body).not.toMatch(/login console/i);
  });
});

describe('challenge: hack-the-planet (frozen-phase short-circuit)', () => {
  // Guards routes/hub.ts: when phase === 'frozen' and ordinal === totalChallenges,
  // render the lights-out focus lobby (hub.ejs) instead of calling the
  // handler. This is the lights-out override specifically wired for #19.
  beforeAll(() => {
    settings.setMany({
      launch_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
      end_at:    new Date(Date.now() - 86400_000).toISOString(),
    });
  });

  it('GET /c/19 in frozen phase renders the lights-out lobby, not the handler', async () => {
    const app = await build();
    const u = findOrCreateUser('htp-frozen@example.com', 'htp-frozen');
    skipTo(u.id, 19);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/lights out/i);
    expect(r.body).not.toMatch(/login console/i);
    expect(r.body).not.toContain(generateFlag(u, 'hack-the-planet'));
  });
});
