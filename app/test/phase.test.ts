import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import * as settings from '../src/lib/settings.js';
import { phase, phaseState } from '../src/lib/phase.js';

beforeAll(() => applySchema());

describe('phase()', () => {
  it('returns uninitialized when launch_at/end_at are not set', () => {
    settings.set('launch_at', null);
    settings.set('end_at', null);
    expect(phase()).toBe('uninitialized');
  });

  it('returns prelaunch / live / frozen based on the clock', () => {
    const launch = new Date('2099-01-01T00:00:00Z');
    const end = new Date('2099-01-08T00:00:00Z');
    settings.setMany({
      launch_at: launch.toISOString(),
      end_at: end.toISOString(),
    });

    expect(phase(new Date('2098-06-01T00:00:00Z'))).toBe('prelaunch');
    expect(phase(new Date('2099-01-04T12:00:00Z'))).toBe('live');
    expect(phase(new Date('2099-12-01T00:00:00Z'))).toBe('frozen');
  });

  it('exposes parsed dates via phaseState', () => {
    settings.setMany({
      launch_at: '2099-01-01T00:00:00.000Z',
      end_at:    '2099-01-08T00:00:00.000Z',
    });
    const ps = phaseState(new Date('2099-01-04T00:00:00Z'));
    expect(ps.launchAt?.toISOString()).toBe('2099-01-01T00:00:00.000Z');
    expect(ps.endAt?.toISOString()).toBe('2099-01-08T00:00:00.000Z');
    expect(ps.phase).toBe('live');
  });
});
