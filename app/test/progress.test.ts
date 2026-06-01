import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';
import { adminSkip, getProgress, lockStateForOrdinal, recordCorrectSubmit, recordWrongSubmit } from '../src/lib/progress.js';
import { totalChallenges } from '../src/challenges/registry.js';

beforeAll(() => applySchema());

describe('sequential progress', () => {
  it('starts a new player at ordinal 1', () => {
    const u = findOrCreateUser('p1@example.com', 'p-one');
    expect(getProgress(u.id)?.current_ordinal).toBe(1);
    expect(lockStateForOrdinal(u.id, 1)).toBe('live');
    expect(lockStateForOrdinal(u.id, 2)).toBe('locked');
  });

  it('advances the ordinal on a correct submit', () => {
    const u = findOrCreateUser('p2@example.com', 'p-two');
    const r = recordCorrectSubmit(u.id, 'white-rabbit', 1, null, null);
    expect(r.advanced).toBe(true);
    expect(getProgress(u.id)?.current_ordinal).toBe(2);
    expect(lockStateForOrdinal(u.id, 1)).toBe('archive');
    expect(lockStateForOrdinal(u.id, 2)).toBe('live');
  });

  it('does NOT advance when the submitted ordinal is not current', () => {
    const u = findOrCreateUser('p3@example.com', 'p-three');
    // Try to record correct on ordinal 5 while still at 1 — should no-op the advance.
    const r = recordCorrectSubmit(u.id, 'headers', 5, null, null);
    expect(r.advanced).toBe(false);
    expect(getProgress(u.id)?.current_ordinal).toBe(1);
  });

  it('logs wrong attempts without advancing', () => {
    const u = findOrCreateUser('p4@example.com', 'p-four');
    recordWrongSubmit(u.id, 'white-rabbit', 'ZERODAY{nope}', '127.0.0.1', 'test');
    expect(getProgress(u.id)?.current_ordinal).toBe(1);
  });

  it('admin skip bumps ordinal and increments admin_skips', () => {
    const u = findOrCreateUser('p5@example.com', 'p-five');
    expect(adminSkip(u.id, 1)).toBe(true);
    const p = getProgress(u.id);
    expect(p?.current_ordinal).toBe(2);
    expect(p?.admin_skips).toBe(1);
  });

  it('refuses skip when ordinal does not match current', () => {
    const u = findOrCreateUser('p6@example.com', 'p-six');
    expect(adminSkip(u.id, 5)).toBe(false);
    expect(getProgress(u.id)?.current_ordinal).toBe(1);
  });

  it('marks completed when the final ordinal is solved', () => {
    const u = findOrCreateUser('p7@example.com', 'p-seven');
    // Force-advance up to the final.
    while ((getProgress(u.id)?.current_ordinal ?? 0) < totalChallenges()) {
      adminSkip(u.id, getProgress(u.id)!.current_ordinal);
    }
    expect(getProgress(u.id)?.current_ordinal).toBe(totalChallenges());
    const r = recordCorrectSubmit(u.id, 'hack-the-planet', totalChallenges(), null, null);
    expect(r.completed).toBe(true);
    expect(getProgress(u.id)?.completed_at).toBeTruthy();
  });
});
