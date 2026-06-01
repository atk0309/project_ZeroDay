import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

// Resolution order:
//   1. DB_PATH (explicit, wins always)
//   2. RAILWAY_VOLUME_MOUNT_PATH/zeroday.db (Railway sets this for any service
//      with a volume attached — landing here means the operator set up the
//      volume but forgot to point DB_PATH at it)
//   3. ./data/zeroday.db (local dev default; ephemeral on Railway)
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  _fs: { existsSync: (p: string) => boolean } = { existsSync },
): { path: string; source: string } {
  if (env.DB_PATH) return { path: env.DB_PATH, source: 'DB_PATH' };
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return {
      path: `${env.RAILWAY_VOLUME_MOUNT_PATH}/zeroday.db`,
      source: 'RAILWAY_VOLUME_MOUNT_PATH',
    };
  }
  return { path: './data/zeroday.db', source: 'default' };
}

const resolved = resolveDbPath();
export const dbPath = resolved.path;
export const dbPathSource = resolved.source;
mkdirSync(dirname(dbPath), { recursive: true });

// Ephemeral-storage warning. On Railway, anything outside the volume mount is
// wiped on every redeploy. If we land on the bare default in production, log
// loudly so the operator can spot the misconfig in deploy logs before the next
// push erases the database again.
const looksEphemeralOnRailway =
  resolved.source === 'default' &&
  !!process.env.RAILWAY_ENVIRONMENT &&
  !isAbsolute(dbPath);
if (looksEphemeralOnRailway) {
  // eslint-disable-next-line no-console
  console.warn(
    `[db] WARNING: DB_PATH is unset on Railway — using ${resolve(dbPath)}. ` +
      `This path is inside the container filesystem and will be wiped on the next deploy. ` +
      `Attach a volume to /data and set DB_PATH=/data/zeroday.db (or rely on RAILWAY_VOLUME_MOUNT_PATH).`
  );
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
