// Hint queue editing UI — body override, level override, persistence, audit.
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applySchema } from './helpers.js';
import { adminDashboardRoutes } from '../src/routes/admin/dashboard.js';
import { adminLoginRoutes } from '../src/routes/admin/login.js';
import { adminSetupRoutes } from '../src/routes/admin/setup.js';
import { db } from '../src/db/index.js';
import { findOrCreateUser } from '../src/lib/playerAuth.js';
import { createSession, SESSION_COOKIE } from '../src/lib/adminAuth.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

async function buildApp() {
  const app = Fastify();
  await app.register(fastifyCookie, { secret: 'test-secret' });
  await app.register(fastifyFormbody);
  await app.register(fastifyView, {
    engine: { ejs },
    root: join(projectRoot, 'web', 'views'),
    propertyName: 'view',
    includeViewExtension: true,
  });
  await app.register(adminLoginRoutes);
  await app.register(adminSetupRoutes);
  await app.register(adminDashboardRoutes);
  return app;
}

beforeAll(() => applySchema());

beforeAll(async () => {
  const got = db.prepare(`SELECT value FROM app_settings WHERE key = 'admin_password_hash'`).get();
  if (!got) {
    const { bootstrapPassword } = await import('../src/lib/adminAuth.js');
    await bootstrapPassword('hunter2hunter2');
  }
});

function asAdmin() {
  const sid = createSession('admin@example.com', '127.0.0.1', 'curl/test');
  return `${SESSION_COOKIE}=${sid}`;
}

// Stage a verified user stuck on `dns-whispers` (#6) for >20h.
// Returns the user id and the canned L1 hint text.
function stageStuckOnDnsWhispers(emailSeed: string) {
  const user = findOrCreateUser(`${emailSeed}@example.com`, emailSeed);
  db.prepare(`UPDATE users SET verified_at = datetime('now') WHERE id = ?`).run(user.id);
  db.prepare(`
    UPDATE user_progress
       SET current_ordinal = 6,
           last_advance_at = datetime('now', '-25 hours')
     WHERE user_id = ?
  `).run(user.id);
  return user.id;
}

// Mirror the dns-whispers handler's hint table. After the 5-tier expansion:
// L1+L2 are the new gentler nudges, L3+L4+L5 are the previous L1-L2-L3.
const CANNED_L1 = 'the operator speaks in pre-arranged whispers. learn the language first.';
const CANNED_L2 = "the page tells you what records it can answer. it doesn't tell you all the names.";
const CANNED_L3 = 'WOPR was a phone-line nerd. before APIs, machines whispered through DNS.';
const CANNED_L4 = 'DNS records carry more than addresses. TXT records carry text — try those.';
const CANNED_L5 = 'query the TXT record at _secret.wopr.example.com.';

function lastHintRow() {
  return db.prepare(`SELECT user_id, challenge_id, level, body FROM hints_sent ORDER BY id DESC LIMIT 1`).get() as
    | { user_id: number; challenge_id: string; level: number; body: string | null }
    | undefined;
}

function lastHintAuditPayload() {
  const row = db.prepare(`SELECT payload FROM admin_audit_log WHERE action = 'send_hint' ORDER BY id DESC LIMIT 1`).get() as
    | { payload: string }
    | undefined;
  return row ? (JSON.parse(row.payload) as Record<string, unknown>) : null;
}

describe('POST /admin/hint — body override and persistence', () => {
  it('without body field, persists canned hint and marks audit customized=false', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_canned_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=1`,
    });
    expect(r.statusCode).toBe(302);
    const row = lastHintRow();
    expect(row?.user_id).toBe(id);
    expect(row?.challenge_id).toBe('dns-whispers');
    expect(row?.level).toBe(1);
    expect(row?.body).toBe(CANNED_L1);
    expect(lastHintAuditPayload()?.customized).toBe(false);
  });

  it('with custom body, persists override and marks audit customized=true', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_custom_form');
    const custom = 'check the TXT records, ace';
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=2&body=${encodeURIComponent(custom)}`,
    });
    expect(r.statusCode).toBe(302);
    const row = lastHintRow();
    expect(row?.body).toBe(custom);
    expect(row?.level).toBe(2);
    const payload = lastHintAuditPayload();
    expect(payload?.customized).toBe(true);
    expect(payload?.bodyLen).toBe(custom.length);
  });

  it('empty body field falls back to canned (whitespace-only too)', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_empty_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=2&body=${encodeURIComponent('   \n  ')}`,
    });
    expect(r.statusCode).toBe(302);
    expect(lastHintRow()?.body).toBe(CANNED_L2);
    expect(lastHintAuditPayload()?.customized).toBe(false);
  });

  it('L4 dispatch persists the new strong-hint canned body', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_l4_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=4`,
    });
    expect(r.statusCode).toBe(302);
    const row = lastHintRow();
    expect(row?.level).toBe(4);
    expect(row?.body).toBe(CANNED_L4);
  });

  it('L5 dispatch persists the spoiler canned body', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_l5_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=5`,
    });
    expect(r.statusCode).toBe(302);
    const row = lastHintRow();
    expect(row?.level).toBe(5);
    expect(row?.body).toBe(CANNED_L5);
  });

  it('rejects level=0 with 400 (out of range below)', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_l0_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=0`,
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects level=6 with 400 (out of range above)', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_l6_form');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=6`,
    });
    expect(r.statusCode).toBe(400);
  });

  it('body longer than 2000 chars rejects 400', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_long_form');
    const before = lastHintRow();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `user_id=${id}&challenge_id=dns-whispers&level=1&body=${encodeURIComponent('x'.repeat(2001))}`,
    });
    expect(r.statusCode).toBe(400);
    // No new row written.
    expect(lastHintRow()?.user_id).toBe(before?.user_id);
  });
});

describe('POST /admin/api/player/:id/hint — JSON route accepts body', () => {
  it('persists custom body via JSON', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_custom_json');
    const custom = 'JSON-route override text';
    const r = await app.inject({
      method: 'POST',
      url: `/admin/api/player/${id}/hint`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'dns-whispers', level: 3, body: custom }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    const row = lastHintRow();
    expect(row?.body).toBe(custom);
    expect(row?.level).toBe(3);
    expect(lastHintAuditPayload()?.customized).toBe(true);
  });

  it('rejects body longer than 2000 chars with 400', async () => {
    const app = await buildApp();
    const id = stageStuckOnDnsWhispers('hint_long_json');
    const r = await app.inject({
      method: 'POST',
      url: `/admin/api/player/${id}/hint`,
      headers: { cookie: asAdmin(), 'content-type': 'application/json' },
      payload: JSON.stringify({ challenge_id: 'dns-whispers', level: 1, body: 'y'.repeat(2001) }),
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('GET /admin/hints — textarea seeded with canned text for selected candidate', () => {
  it('renders the L1 canned hint inside the textarea for a stuck dns-whispers operator', async () => {
    const app = await buildApp();
    stageStuckOnDnsWhispers('hint_render_seed');
    const r = await app.inject({
      method: 'GET',
      url: '/admin/hints?s=hint_render_seed',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    // Textarea + canned L1 string both present in HTML
    expect(r.body).toContain('data-hint-textarea');
    expect(r.body).toContain(CANNED_L1);
    // Editable label, not the old read-only one
    expect(r.body).toContain('canned · editable');
    expect(r.body).not.toContain('read-only · PR2');
  });

  it('falls back to first stuck row when ?s=<alias> does not match (template + cannedHints stay aligned)', async () => {
    const app = await buildApp();
    stageStuckOnDnsWhispers('hint_stale_seed');
    const r = await app.inject({
      method: 'GET',
      url: '/admin/hints?s=ghost_alias_that_does_not_exist',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    // Textarea must still be seeded with the first stuck row's canned text.
    expect(r.body).toContain('data-hint-textarea');
    expect(r.body).toContain(CANNED_L1);
  });
});
