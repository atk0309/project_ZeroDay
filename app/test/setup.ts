// Per-process fresh DB. Env must be set before any module imports `db`,
// so this file sets DB_PATH then dynamically imports the db + schema before
// the test file's static imports resolve.
//
// Vitest runs setupFiles before the test file's module graph loads, so the
// statements prepared at top-level in lib/* will see the schema in place.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'zeroday-test-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.FLAG_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-cookie-secret';
process.env.NODE_ENV = 'test';

const { db } = await import('../src/db/index.js');
const { challenges } = await import('../src/challenges/registry.js');
const schemaPath = new URL('../src/db/schema.sql', import.meta.url);
db.exec(readFileSync(schemaPath, 'utf8'));

const upsert = db.prepare(`
  INSERT INTO challenges (id, ordinal, title, category, points, subdomain)
  VALUES (@id, @ordinal, @title, @category, @points, @subdomain)
  ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal
`);
for (const c of challenges) upsert.run(c);
