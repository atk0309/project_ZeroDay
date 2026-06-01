import { describe, it, expect } from 'vitest';
import { resolveDbPath } from '../src/db/index.js';

function fakeFs(existing: string[]): { existsSync: (p: string) => boolean } {
  const set = new Set(existing);
  return { existsSync: (p: string) => set.has(p) };
}

describe('resolveDbPath', () => {
  it('honors explicit DB_PATH', () => {
    const r = resolveDbPath({ DB_PATH: '/data/zeroday.db' } as NodeJS.ProcessEnv, fakeFs([]));
    expect(r.path).toBe('/data/zeroday.db');
    expect(r.source).toBe('DB_PATH');
  });

  it('uses RAILWAY_VOLUME_MOUNT_PATH when DB_PATH is unset', () => {
    const r = resolveDbPath(
      { RAILWAY_VOLUME_MOUNT_PATH: '/data' } as NodeJS.ProcessEnv,
      fakeFs([]),
    );
    expect(r.path).toBe('/data/zeroday.db');
    expect(r.source).toBe('RAILWAY_VOLUME_MOUNT_PATH');
  });

  it('falls back to ./data/zeroday.db when neither env is set', () => {
    const r = resolveDbPath({} as NodeJS.ProcessEnv, fakeFs([]));
    expect(r.path).toBe('./data/zeroday.db');
    expect(r.source).toBe('default');
  });
});
