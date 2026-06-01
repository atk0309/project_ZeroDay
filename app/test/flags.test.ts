import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';
import { generateFlag, verifyFlag } from '../src/lib/flags.js';

beforeAll(() => applySchema());

describe('per-player salted flags', () => {
  it('generates a deterministic ZERODAY{...} flag per (user, challenge)', () => {
    const u = findOrCreateUser('a@example.com', 'alpha');
    const f1 = generateFlag(u, 'caesars-ghost');
    const f2 = generateFlag(u, 'caesars-ghost');
    expect(f1).toMatch(/^ZERODAY\{[A-F0-9]{24}\}$/);
    expect(f1).toBe(f2);
  });

  it('produces different flags for different users on the same challenge', () => {
    const a = findOrCreateUser('user-a@example.com', 'a-user');
    const b = findOrCreateUser('user-b@example.com', 'b-user');
    const fa = generateFlag(a, 'caesars-ghost');
    const fb = generateFlag(b, 'caesars-ghost');
    expect(fa).not.toBe(fb);
  });

  it("does not validate one user's flag under another user", () => {
    const a = findOrCreateUser('iso-a@example.com', 'iso-a');
    const b = findOrCreateUser('iso-b@example.com', 'iso-b');
    const fa = generateFlag(a, 'caesars-ghost');
    expect(verifyFlag(a, 'caesars-ghost', fa)).toBe(true);
    expect(verifyFlag(b, 'caesars-ghost', fa)).toBe(false);
  });

  it('rejects malformed and tampered submissions', () => {
    const u = findOrCreateUser('mal@example.com', 'malformed');
    const f = generateFlag(u, 'caesars-ghost');
    expect(verifyFlag(u, 'caesars-ghost', '')).toBe(false);
    expect(verifyFlag(u, 'caesars-ghost', f.slice(0, -2) + 'XX')).toBe(false);
    expect(verifyFlag(u, 'caesars-ghost', f + ' ')).toBe(true); // trim() tolerates trailing whitespace
  });
});
