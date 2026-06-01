// gibsonKeyStatus() drives the /admin/setup review panel's "N of 3 wired"
// row. Anchoring the count to the GIBSON_KEY_PARTS table + registry's
// `embedsKeyPart` field stops the panel from drifting out of sync the way the
// previously-hardcoded "0 of 3 wired" line did when part 1 went live.

import { describe, it, expect } from 'vitest';
import { gibsonKeyStatus, isKeyPartWired } from '../src/lib/gibson.js';
import { challenges } from '../src/challenges/registry.js';

describe('gibson key wiring', () => {
  it('flags 16-hex-char values as wired; placeholders would not be', () => {
    expect(isKeyPartWired(1)).toBe(true);
    expect(isKeyPartWired(2)).toBe(true);
    expect(isKeyPartWired(3)).toBe(true);
    // Sanity: the placeholder pattern is what wired() guards against.
    expect(/^[0-9A-Fa-f]{16}$/.test('__PLACEHOLDER_K3__')).toBe(false);
  });

  it('returns one entry per key part, joined with the registry by embedsKeyPart', () => {
    const status = gibsonKeyStatus();
    expect(status.total).toBe(3);
    expect(status.parts.map((p) => p.n)).toEqual([1, 2, 3]);

    const expectedOrdinals = [1, 2, 3].map((n) => {
      const meta = challenges.find((c) => c.embedsKeyPart === n);
      return meta?.ordinal ?? null;
    });
    expect(status.parts.map((p) => p.ordinal)).toEqual(expectedOrdinals);
    expect(status.parts.map((p) => p.challengeId)).toEqual(
      [1, 2, 3].map((n) => challenges.find((c) => c.embedsKeyPart === n)?.id ?? null),
    );
  });

  it('counts only real hex parts, not placeholders, and lists pending ordinals', () => {
    const status = gibsonKeyStatus();
    const wiredParts = status.parts.filter((p) => p.wired);
    const pendingParts = status.parts.filter((p) => !p.wired);
    expect(status.wired).toBe(wiredParts.length);

    expect(status.wiredOrdinals).toEqual(
      wiredParts.map((p) => p.ordinal).filter((o): o is number => o !== null),
    );
    expect(status.pendingOrdinals).toEqual(
      pendingParts.map((p) => p.ordinal).filter((o): o is number => o !== null),
    );
  });

  it('today: all three parts are wired (#7 matryoshka, #13 ports-of-call, #17 stego-static)', () => {
    const status = gibsonKeyStatus();
    expect(status.wired).toBe(3);
    expect(status.wiredOrdinals).toEqual([7, 13, 17]);
    expect(status.pendingOrdinals).toEqual([]);
  });
});
