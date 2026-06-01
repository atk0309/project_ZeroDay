// Challenge 16 — git-archaeology. Logic, public seed repo + git history dive.
// Solve: ?secret=<canonical-line-from-deploy.sh-history>.

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { verifySecret, REPO_URL } from '../src/challenges/handlers/git-archaeology.js';

// The handler reads GIT_ARCHAEOLOGY_SECRET_DIGEST at request time. We point it
// at a synthetic test plaintext so the real canonical answer never appears in
// the test source — the production puzzle answer must be recovered from the
// public seed repo's git history, not from this codebase.
const CANONICAL = 'TEST_DEPLOY_KEY_LINE_DO_NOT_USE_IN_PROD';
const TEST_DIGEST_HEX = createHash('sha256').update(CANONICAL, 'utf8').digest('hex');

beforeAll(() => {
  applySchema();
  process.env.GIT_ARCHAEOLOGY_SECRET_DIGEST = TEST_DIGEST_HEX;
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

function skipTo(userId: number, ordinal: number) {
  for (let i = 1; i < ordinal; i++) adminSkip(userId, i);
}

const HUB_URL = '/c/16';
const HACK_HOST = 'hack.example.com';

describe('challenge: git-archaeology (pure)', () => {
  it('idle on empty / null input', () => {
    expect(verifySecret(null).kind).toBe('idle');
    expect(verifySecret('').kind).toBe('idle');
  });

  it('wrong on near-misses', () => {
    expect(verifySecret('ZERODAY_DEPLOY_KEY=').kind).toBe('wrong');
    expect(verifySecret(CANONICAL.toLowerCase()).kind).toBe('wrong');
    expect(verifySecret(CANONICAL + ' ').kind).toBe('wrong');
  });

  it('ok on canonical secret', () => {
    expect(verifySecret(CANONICAL).kind).toBe('ok');
  });
});

describe('challenge: git-archaeology (route)', () => {
  it('GET /c/16 with no secret renders the repo link, no flag leak', async () => {
    const app = await build();
    const u = findOrCreateUser('ga-render@example.com', 'ga-render');
    skipTo(u.id, 16);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL,
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(REPO_URL);
    expect(r.body).toMatch(/leak triage/i);
    expect(r.body).toMatch(/git log -p/i);
    expect(r.body).not.toContain(generateFlag(u, 'git-archaeology'));
    expect(r.body).not.toContain(CANONICAL);
  });

  it('correct secret reveals the per-player flag', async () => {
    const app = await build();
    const u = findOrCreateUser('ga-solve@example.com', 'ga-solve');
    skipTo(u.id, 16);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?secret=' + encodeURIComponent(CANONICAL),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/trace confirmed/i);
    expect(r.body).toContain(generateFlag(u, 'git-archaeology'));
  });

  it('wrong secret does not reveal the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('ga-wrong@example.com', 'ga-wrong');
    skipTo(u.id, 16);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: HUB_URL + '?secret=' + encodeURIComponent('not-the-line'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/not in the record/i);
    expect(r.body).not.toContain(generateFlag(u, 'git-archaeology'));
  });

  it('also works on the hack host (subdomain dispatch)', async () => {
    const app = await build();
    const u = findOrCreateUser('ga-host@example.com', 'ga-host');
    skipTo(u.id, 16);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/?secret=' + encodeURIComponent(CANONICAL),
      headers: { host: HACK_HOST, cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'git-archaeology'));
  });

  it('two players: same canonical, different flags, no cross-leak', async () => {
    const app = await build();
    const a = findOrCreateUser('ga-a@example.com', 'ga-a');
    const b = findOrCreateUser('ga-b@example.com', 'ga-b');
    skipTo(a.id, 16);
    skipTo(b.id, 16);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const url = HUB_URL + '?secret=' + encodeURIComponent(CANONICAL);
    const ra = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sb}` } });
    expect(ra.body).toContain(generateFlag(a, 'git-archaeology'));
    expect(rb.body).toContain(generateFlag(b, 'git-archaeology'));
    expect(ra.body).not.toContain(generateFlag(b, 'git-archaeology'));
    expect(rb.body).not.toContain(generateFlag(a, 'git-archaeology'));
  });
});
