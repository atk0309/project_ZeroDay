// Challenge 18 — ghost-shell. Per-player narrative secret + cheat detection
// on secret-sharing. Mitnick-flavored OSINT on mitnick.example.com.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { db } from '../src/db/index.js';
import { findOrCreateUser, createSession, type User } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import {
  HANDLES,
  DECOY_ROSTER,
  secretForUser,
  detectGhostSupplier,
} from '../src/lib/ghostShell.js';
import { evaluateSubmit } from '../src/challenges/handlers/ghost-shell.js';

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

function userRow(id: number): User {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User;
}

function strikesFor(supplierId: number) {
  return db.prepare(`SELECT * FROM cheat_strikes WHERE supplier_id = ? ORDER BY id`).all(supplierId) as Record<string, unknown>[];
}

const HUB_URL = '/c/18';
const MITNICK_HOST = 'mitnick.example.com';

describe('challenge: ghost-shell (pure)', () => {
  it('secretForUser is deterministic across repeated calls', () => {
    const u = { flag_salt: 'aabbccddeeff00112233445566778899' };
    const a = secretForUser(u);
    const b = secretForUser(u);
    const c = secretForUser(u);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('secretForUser shape is <handle>-<NNNNNN> with handle in HANDLES', () => {
    for (let i = 0; i < 30; i++) {
      const salt = Buffer.from(`salt-${i}`).toString('hex').padEnd(32, '0');
      const s = secretForUser({ flag_salt: salt });
      expect(s).toMatch(/^[a-z]+-\d{6}$/);
      const handle = s.split('-')[0];
      expect(HANDLES).toContain(handle);
    }
  });

  it('secretForUser is per-user-distinct over many random salts', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const salt = Buffer.from(`distinct-${i}-${Math.random()}`).toString('hex').slice(0, 32);
      seen.add(secretForUser({ flag_salt: salt }));
    }
    // 64 * 1_000_000 ≈ 64M space; 50 random samples should give zero collisions
    // with overwhelming probability.
    expect(seen.size).toBeGreaterThanOrEqual(49);
  });

  it('evaluateSubmit returns idle on empty / null input', () => {
    const u = { flag_salt: 'idleuser000000000000000000000000' };
    expect(evaluateSubmit(u, null).kind).toBe('idle');
    expect(evaluateSubmit(u, '').kind).toBe('idle');
    expect(evaluateSubmit(u, '   ').kind).toBe('idle');
  });

  it('evaluateSubmit returns ok on the canonical per-player secret (case-insensitive)', () => {
    const u = { flag_salt: 'okuser11111111111111111111111111' };
    const s = secretForUser(u);
    expect(evaluateSubmit(u, s).kind).toBe('ok');
    expect(evaluateSubmit(u, s.toUpperCase()).kind).toBe('ok');
    expect(evaluateSubmit(u, '  ' + s + '  ').kind).toBe('ok');
  });

  it('evaluateSubmit returns wrong on garbage input', () => {
    const u = { flag_salt: 'wronguser2222222222222222222222' };
    const r = evaluateSubmit(u, 'definitely-not-it');
    expect(r.kind).toBe('wrong');
  });

  it('detectGhostSupplier returns null on shape-miss / empty / gibberish', () => {
    expect(detectGhostSupplier(0, '')).toBeNull();
    expect(detectGhostSupplier(0, 'hello')).toBeNull();
    expect(detectGhostSupplier(0, 'condor')).toBeNull();
    expect(detectGhostSupplier(0, '!!!!--####')).toBeNull();
  });

  it("detectGhostSupplier finds the supplier when shape matches another user's secret", () => {
    const a = findOrCreateUser('gs-pure-a@example.com', 'gs-pure-a');
    const b = findOrCreateUser('gs-pure-b@example.com', 'gs-pure-b');
    const bSecret = secretForUser(b);
    const found = detectGhostSupplier(a.id, bSecret);
    expect(found).not.toBeNull();
    expect(found!.supplierId).toBe(b.id);
    expect(found!.supplierAlias).toBe('gs-pure-b');
  });

  it('detectGhostSupplier excludes the consumer (self-match returns null)', () => {
    const a = findOrCreateUser('gs-self@example.com', 'gs-self');
    const aSecret = secretForUser(a);
    expect(detectGhostSupplier(a.id, aSecret)).toBeNull();
  });
});

describe('challenge: ghost-shell (route)', () => {
  it('GET /c/18 renders mitnick-flavored landing without leaking flag or secret', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-land@example.com', 'gs-land');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/mitnick/i);
    expect(r.body).toMatch(/social layer/i);
    expect(r.body).not.toContain(generateFlag(u, 'ghost-shell'));
    expect(r.body).not.toContain(secretForUser(u));
    // Landing must not name /staff directly — robots.txt is the breadcrumb.
    expect(r.body).not.toMatch(/\/staff/);
  });

  it('GET /c/18/robots.txt returns text/plain with Disallow: /staff', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-robots@example.com', 'gs-robots');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/robots.txt',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    expect(r.body).toMatch(/Disallow:\s*\/staff/);
  });

  it('GET /c/18/staff lists every decoy handle, redacts visible text everywhere, and leaks the personal secret in exactly one alt attribute', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-staff@example.com', 'gs-staff');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/staff',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);

    // Every decoy role+era pair appears in the body.
    for (const d of DECOY_ROSTER) {
      expect(r.body).toContain(d.role);
      expect(r.body).toContain(d.era);
    }

    // Personal secret leaks via avatar alt attribute, exactly once.
    const secret = secretForUser(u);
    const altMatches = r.body.match(new RegExp(`alt="${secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'));
    expect(altMatches).not.toBeNull();
    expect(altMatches!.length).toBe(1);

    // Decoy alts are all [REDACTED] — at least 8 of them.
    const redactedAlts = r.body.match(/alt="\[REDACTED\]"/g) ?? [];
    expect(redactedAlts.length).toBeGreaterThanOrEqual(DECOY_ROSTER.length);

    // Visible row text is redacted everywhere — i.e. the secret string never
    // appears in user-facing text outside the alt attribute. Strip the alt
    // occurrence and assert the secret is gone.
    const stripped = r.body.replace(new RegExp(`alt="${secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), '');
    expect(stripped).not.toContain(secret);
  });

  it('GET /c/18?find=<correct secret> renders the per-player flag', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-solve-land@example.com', 'gs-solve-land');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?find=' + encodeURIComponent(secretForUser(u)),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'ghost-shell'));
  });

  it('GET /c/18/staff?find=<correct secret> also renders the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-solve-staff@example.com', 'gs-solve-staff');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/staff?find=' + encodeURIComponent(secretForUser(u)),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'ghost-shell'));
  });

  it('wrong input produces no flag, no cheat row, no freeze', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-wrong@example.com', 'gs-wrong');
    skipTo(u.id, 18);
    const sid = createSession(u.id);
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM cheat_strikes`).get() as { n: number }).n;

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?find=nonsense-9999',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(generateFlag(u, 'ghost-shell'));
    expect(userRow(u.id).frozen_at).toBeNull();
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM cheat_strikes`).get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('GET /c/18/anything-else returns a 404 with no leaks', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-404@example.com', 'gs-404');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '/admin-console',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain(generateFlag(u, 'ghost-shell'));
    expect(r.body).not.toContain(secretForUser(u));
  });

  it('two players: distinct secrets and distinct flags', async () => {
    const a = findOrCreateUser('gs-iso-a@example.com', 'gs-iso-a');
    const b = findOrCreateUser('gs-iso-b@example.com', 'gs-iso-b');
    expect(secretForUser(a)).not.toBe(secretForUser(b));
    expect(generateFlag(a, 'ghost-shell')).not.toBe(generateFlag(b, 'ghost-shell'));
  });

  it('subdomain dispatch parity: mitnick.example.com/ landing matches /c/18', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-host-land@example.com', 'gs-host-land');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: MITNICK_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/mitnick/i);
    expect(r.body).toMatch(/social layer/i);
  });

  it('subdomain dispatch parity: mitnick.example.com/staff leaks the personal alt', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-host-staff@example.com', 'gs-host-staff');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/staff',
      headers: { host: MITNICK_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    const secret = secretForUser(u);
    expect(r.body).toContain(`alt="${secret}"`);
  });

  it('subdomain dispatch parity: mitnick.example.com/robots.txt returns the breadcrumb', async () => {
    const app = await build();
    const u = findOrCreateUser('gs-host-robots@example.com', 'gs-host-robots');
    skipTo(u.id, 18);
    const sid = createSession(u.id);

    const r = await app.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { host: MITNICK_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/Disallow:\s*\/staff/);
  });
});

describe('challenge: ghost-shell (anti-cheat hardening)', () => {
  it("submitting another player's secret does not mutate cheat/freeze state from GET", async () => {
    const app = await build();
    const a = findOrCreateUser('gs-cheat-a@example.com', 'gs-cheat-a');
    const b = findOrCreateUser('gs-cheat-b@example.com', 'gs-cheat-b');
    skipTo(a.id, 18);
    skipTo(b.id, 18);
    const sa = createSession(a.id);
    const bSecret = secretForUser(b);

    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?find=' + encodeURIComponent(bSecret),
      headers: { cookie: `player_session=${sa}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/not the name/i);
    expect(r.body).not.toContain(generateFlag(a, 'ghost-shell'));

    // Consumer (A) remains unfrozen.
    const aRow = userRow(a.id);
    expect(aRow.frozen_at).toBeNull();

    // Supplier (B) remains unstruck and unfrozen.
    const bRow = userRow(b.id);
    expect(bRow.frozen_at).toBeNull();
    expect(bRow.cheat_strikes).toBe(0);

    // No strike rows are written from this GET.
    const strikes = strikesFor(b.id);
    expect(strikes).toHaveLength(0);
  });
});
