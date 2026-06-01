-- zeroday ARG schema. SQLite. Hand-rolled migrations.
-- Apply via app/src/db/migrate.ts. Idempotent: every CREATE uses IF NOT EXISTS.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Players (kids). Magic-link auth, no passwords.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  alias         TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at   TEXT,
  last_seen_at  TEXT,
  flag_salt     TEXT NOT NULL,                  -- per-user random salt; combined with FLAG_SECRET to derive per-(user,challenge) flags
  frozen_at     TEXT,                            -- non-null: account locked out (cheat or admin ban)
  frozen_reason TEXT,                            -- 'cheat_consumer' | 'cheat_supplier_strike2' | 'admin_ban'
  cheat_strikes INTEGER NOT NULL DEFAULT 0       -- count of times this user's flag was found in another op's submission
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Magic-link tokens for player login. One-time, time-limited.
CREATE TABLE IF NOT EXISTS magic_links (
  token        TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL,  -- 'signup' | 'login'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT
);

-- Player session cookies (server-side state, cookie holds opaque id).
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Static challenge metadata. Mirrors the registry in app/src/challenges.
CREATE TABLE IF NOT EXISTS challenges (
  id        TEXT PRIMARY KEY,             -- slug, e.g. 'white-rabbit'
  ordinal   INTEGER NOT NULL UNIQUE,      -- 1..19, drives sequential unlock
  title     TEXT NOT NULL,
  category  TEXT NOT NULL,
  points    INTEGER NOT NULL DEFAULT 0,
  subdomain TEXT NOT NULL                 -- e.g. 'wopr.example.com'
);

-- Per-player progress. One row per user; created on first login.
CREATE TABLE IF NOT EXISTS user_progress (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_ordinal  INTEGER NOT NULL DEFAULT 1,        -- the challenge they can attempt
  last_advance_at  TEXT NOT NULL DEFAULT (datetime('now')),
  admin_skips      INTEGER NOT NULL DEFAULT 0,
  completed_at     TEXT
);

-- Every flag-submit attempt (right or wrong). Anti-cheat + analytics.
CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  submitted    TEXT NOT NULL,
  correct      INTEGER NOT NULL,         -- 0 or 1
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, challenge_id);

-- Successful solves. One row per (user, challenge).
CREATE TABLE IF NOT EXISTS solves (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  solved_at    TEXT NOT NULL DEFAULT (datetime('now')),
  flag_source  TEXT NOT NULL DEFAULT 'player',  -- 'player' | 'admin_skip'
  PRIMARY KEY (user_id, challenge_id)
);

-- Hint dispatches. Honesty leaderboard column reads from here.
CREATE TABLE IF NOT EXISTS hints_sent (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  level        INTEGER NOT NULL,         -- 1..5 (nudge → spoiler)
  sent_at      TEXT NOT NULL DEFAULT (datetime('now')),
  body         TEXT                      -- text actually sent (canned or admin-edited); NULL only on rows pre-dating this column
);

-- Cheat-strike queue. One row per detection (a user's flag was found in
-- another op's submission). The supplier's first-login experience reads
-- unack'd rows; admin can also clear strikes manually.
CREATE TABLE IF NOT EXISTS cheat_strikes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- whose flag was leaked
  consumer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who submitted it
  challenge_id    TEXT NOT NULL REFERENCES challenges(id),
  detected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,                                                     -- supplier viewed the experience
  strike_number   INTEGER NOT NULL,                                         -- snapshot of supplier.cheat_strikes after this strike
  submitted_flag  TEXT,                                                     -- the verbatim flag the consumer submitted (used by /frozen evidence panel)
  consumer_ip     TEXT,                                                     -- consumer's IP at time of submit
  consumer_ua     TEXT                                                      -- consumer's user-agent at time of submit
);
CREATE INDEX IF NOT EXISTS idx_cheat_strikes_supplier_unack
  ON cheat_strikes(supplier_id, acknowledged_at);

-- Generic event log. Cheap append-only. Used for the live admin feed.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,            -- 'attempt' | 'solve' | 'hint' | 'admin_skip' | 'login' | 'signup' | 'config_change'
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload    TEXT,                     -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Application settings (DB-backed, replaces env vars for runtime concerns).
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin sessions (separate cookie/scope from player sessions).
-- Note: `ip` and `user_agent` are added below via ALTER TABLE in migrate.ts
-- for older databases. Fresh databases get them via this CREATE TABLE.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);

-- Admin login magic-link tokens.
CREATE TABLE IF NOT EXISTS admin_magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT
);

-- Audit trail of admin actions. Readable from the admin dashboard.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  action     TEXT NOT NULL,            -- 'login' | 'login_fail' | 'set_password' | 'config_change' | 'skip' | 'send_hint' | 'send_test_mail' | 'invite_send' | 'invite_revoke' | 'request_approve' | 'request_deny'
  target     TEXT,                     -- e.g. user id, setting key
  payload    TEXT,                     -- JSON
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);

-- Operator-issued invitations.
-- Lifecycle: pending → accepted | revoked | expired.
CREATE TABLE IF NOT EXISTS invitations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  token                  TEXT NOT NULL UNIQUE,                 -- 48 hex chars
  inviter_id             INTEGER REFERENCES users(id) ON DELETE CASCADE, -- nullable: admin_override w/ custom alias
  invitee_email          TEXT NOT NULL,                        -- lowercased at insert
  note                   TEXT,                                 -- optional, ≤240 chars
  status                 TEXT NOT NULL DEFAULT 'pending',      -- pending|accepted|revoked|expired
  source                 TEXT NOT NULL DEFAULT 'operator',     -- operator|admin_override|admin_grant
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at             TEXT NOT NULL,
  claimed_at             TEXT,
  claimed_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_at             TEXT,
  revoked_by             TEXT,                                 -- 'operator' | admin email
  inviter_alias_override TEXT                                  -- admin override · custom display alias
);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email   ON invitations(invitee_email);

-- Operator → admin "give me a 3rd slot" requests.
-- Lifecycle: pending → approved | denied. Approval spawns an invitations
-- row with source='admin_grant' and links it via granted_invitation_id.
CREATE TABLE IF NOT EXISTS invite_requests (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_email         TEXT,                            -- optional target
  reason                TEXT NOT NULL,                   -- ≤500 chars
  status                TEXT NOT NULL DEFAULT 'pending', -- pending|approved|denied
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at            TEXT,
  decided_by            TEXT,                            -- admin email
  decision_note         TEXT,
  granted_invitation_id INTEGER REFERENCES invitations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invreq_requester ON invite_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_invreq_status    ON invite_requests(status, created_at);
