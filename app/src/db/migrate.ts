import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './index.js';
import { challenges } from '../challenges/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');

db.exec(schema);

// Additive column migrations for tables that pre-date the new columns.
// SQLite's ALTER TABLE ADD COLUMN doesn't accept IF NOT EXISTS, so we
// inspect `pragma table_info(<table>)` first.
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`migrated: ${table}.${column}`);
}
addColumnIfMissing('admin_sessions', 'ip', 'ip TEXT');
addColumnIfMissing('admin_sessions', 'user_agent', 'user_agent TEXT');
addColumnIfMissing('hints_sent', 'body', 'body TEXT');
addColumnIfMissing('users', 'frozen_at', 'frozen_at TEXT');
addColumnIfMissing('users', 'frozen_reason', 'frozen_reason TEXT');
addColumnIfMissing('users', 'cheat_strikes', 'cheat_strikes INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('cheat_strikes', 'submitted_flag', 'submitted_flag TEXT');
addColumnIfMissing('cheat_strikes', 'consumer_ip', 'consumer_ip TEXT');
addColumnIfMissing('cheat_strikes', 'consumer_ua', 'consumer_ua TEXT');
addColumnIfMissing('invitations', 'inviter_alias_override', 'inviter_alias_override TEXT');

// Drop NOT NULL on invitations.inviter_id so admin_override invites can be
// issued without an attributed operator (the bootstrap-the-first-operator
// case). SQLite has no ALTER COLUMN, so we rebuild the table when an old
// schema is detected.
function dropInviterIdNotNull() {
  const cols = db.prepare(`PRAGMA table_info(invitations)`).all() as { name: string; notnull: number }[];
  const inviterCol = cols.find((c) => c.name === 'inviter_id');
  if (!inviterCol || inviterCol.notnull === 0) return;
  console.log('migrating: invitations.inviter_id → nullable');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;
    CREATE TABLE invitations_new (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      token                  TEXT NOT NULL UNIQUE,
      inviter_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
      invitee_email          TEXT NOT NULL,
      note                   TEXT,
      status                 TEXT NOT NULL DEFAULT 'pending',
      source                 TEXT NOT NULL DEFAULT 'operator',
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at             TEXT NOT NULL,
      claimed_at             TEXT,
      claimed_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      revoked_at             TEXT,
      revoked_by             TEXT,
      inviter_alias_override TEXT
    );
    INSERT INTO invitations_new (
      id, token, inviter_id, invitee_email, note, status, source,
      created_at, expires_at, claimed_at, claimed_user_id, revoked_at,
      revoked_by, inviter_alias_override
    )
    SELECT
      id, token, inviter_id, invitee_email, note, status, source,
      created_at, expires_at, claimed_at, claimed_user_id, revoked_at,
      revoked_by, inviter_alias_override
    FROM invitations;
    DROP TABLE invitations;
    ALTER TABLE invitations_new RENAME TO invitations;
    CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_id, status);
    CREATE INDEX IF NOT EXISTS idx_invitations_email   ON invitations(invitee_email);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
dropInviterIdNotNull();

// Mirror the in-process challenge registry into the challenges table so admin
// queries can JOIN against it. INSERT OR REPLACE is fine — registry is the
// source of truth.
const upsert = db.prepare(`
  INSERT INTO challenges (id, ordinal, title, category, points, subdomain)
  VALUES (@id, @ordinal, @title, @category, @points, @subdomain)
  ON CONFLICT(id) DO UPDATE SET
    ordinal=excluded.ordinal,
    title=excluded.title,
    category=excluded.category,
    points=excluded.points,
    subdomain=excluded.subdomain
`);
const tx = db.transaction(() => {
  for (const c of challenges) upsert.run(c);
});
tx();

console.log(`migrated ${challenges.length} challenges into registry`);
