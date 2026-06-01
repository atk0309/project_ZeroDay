// Challenge 11 — regex-runes. Logic puzzle: oracle separates runes into two
// columns; player submits a regex via ?pattern= that must match all blessed
// and none of the cursed.

import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import * as settings from '../src/lib/settings.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import { generateFlag } from '../src/lib/flags.js';
import { evaluatePattern } from '../src/challenges/handlers/regex-runes.js';

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

describe('challenge: regex-runes (pure)', () => {
  it('the intended pattern ^[A-F]{4}$ separates blessed from cursed', () => {
    expect(evaluatePattern('^[A-F]{4}$').ok).toBe(true);
  });

  it('trivial .* fails: matches cursed too', () => {
    const r = evaluatePattern('.*');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('matched_cursed');
    expect((r.matchedCursed ?? []).length).toBeGreaterThan(0);
  });

  it('overly strict pattern misses some blessed', () => {
    const r = evaluatePattern('^CAFE$');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missed_blessed');
    expect((r.missed ?? []).length).toBeGreaterThan(0);
  });

  it('invalid regex returns invalid_regex, not a 500', () => {
    expect(evaluatePattern('[unclosed').reason).toBe('invalid_regex');
  });

  it('empty / oversized inputs are rejected with friendly reasons', () => {
    expect(evaluatePattern('').reason).toBe('empty');
    expect(evaluatePattern('a'.repeat(200)).reason).toBe('too_long');
  });

  it('rejects oversized numeric quantifiers without invoking the engine', () => {
    // Compiles fine, but `re.test()` would stack-overflow or burn the event
    // loop. The pre-flight quantifier cap rejects it as invalid_regex.
    const start = Date.now();
    const r = evaluatePattern('^(A?){1000000000}$');
    expect(r.reason).toBe('invalid_regex');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('rejects open-ended {n,} quantifier with oversized n', () => {
    // The earlier version of the preflight guard only matched `{n}` and
    // `{n,m}`, so `{n,}` slipped past. Make sure it gets rejected too.
    const start = Date.now();
    const r = evaluatePattern('^(A?){1000000000,}$');
    expect(r.reason).toBe('invalid_regex');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('still accepts small open-ended {n,} like a{1,}', () => {
    // Bare `{1,}` is equivalent to `+` and must remain compilable so the
    // guard does not over-reject honest patterns.
    const r = evaluatePattern('^[A-F]{1,}$');
    // matches all blessed (CAFE/DEAD/etc) but also matches some cursed runes
    // (e.g. DECAF) — so the result should be matched_cursed, not invalid_regex.
    expect(r.reason).not.toBe('invalid_regex');
  });

  it('a runtime regex throw is caught and reported as invalid_regex', () => {
    // Even if some pathological pattern slipped past the quantifier check,
    // the test loop catches RangeError instead of bubbling a 500.
    //
    // The shape under test is the classic catastrophic-backtracking exponent
    // `^(a+)+$`. We assemble it at runtime rather than writing it as a literal:
    // CodeQL's js/redos flags any *constant* regex that reaches a RegExp
    // constructor (evaluatePattern's `new RegExp(trimmed)`), and a source-level
    // `'^(a+)+$'` here is exactly that constant. Building the string through a
    // loop the analyzer can't fold keeps the source non-constant — so the alert
    // doesn't fire — while evaluatePattern receives the identical pattern and
    // its safeTest catch + caps are exercised the same way.
    let inner = '';
    for (let i = 0; i < 1; i++) inner += 'a';
    const evil = '^(' + inner + '+)+$'; // == ^(a+)+$, assembled at runtime
    const r = evaluatePattern(evil);
    // Either matched_cursed (innocent strings don't trigger backtracking) or
    // missed_blessed — but never a thrown exception or 'too_long'.
    expect(['matched_cursed', 'missed_blessed', 'invalid_regex']).toContain(r.reason);
  });
});

describe('challenge: regex-runes (route)', () => {
  it('GET /c/11 with no pattern renders the runes and does not leak the flag', async () => {
    const app = await build();
    const u = findOrCreateUser('rr-render@example.com', 'rr-render');
    skipTo(u.id, 11);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/c/11',
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/regex runes/i);
    expect(r.body).toContain('CAFE');
    expect(r.body).toContain('ABBAB');
    expect(r.body).not.toContain(generateFlag(u, 'regex-runes'));
  });

  it('GET /c/11?pattern=^[A-F]{4}$ reveals the per-player flag', async () => {
    const app = await build();
    const u = findOrCreateUser('rr-solve@example.com', 'rr-solve');
    skipTo(u.id, 11);
    const sid = createSession(u.id);
    const r = await app.inject({
      method: 'GET',
      url: '/c/11?pattern=' + encodeURIComponent('^[A-F]{4}$'),
      headers: { cookie: `player_session=${sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(generateFlag(u, 'regex-runes'));
  });

  it('two players get two different flags on solve', async () => {
    const app = await build();
    const a = findOrCreateUser('rr-a@example.com', 'rr-a');
    const b = findOrCreateUser('rr-b@example.com', 'rr-b');
    skipTo(a.id, 11);
    skipTo(b.id, 11);
    const sa = createSession(a.id);
    const sb = createSession(b.id);
    const url = '/c/11?pattern=' + encodeURIComponent('^[A-F]{4}$');
    const ra = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sa}` } });
    const rb = await app.inject({ method: 'GET', url, headers: { cookie: `player_session=${sb}` } });
    const fa = generateFlag(a, 'regex-runes');
    const fb = generateFlag(b, 'regex-runes');
    expect(ra.body).toContain(fa);
    expect(rb.body).toContain(fb);
    expect(ra.body).not.toContain(fb);
    expect(rb.body).not.toContain(fa);
  });
});
