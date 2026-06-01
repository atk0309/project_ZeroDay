// Pass-2 admin console: variation cookie, search/filter, JSON drawer endpoint,
// events polling, and admin_sessions migration + revoke.

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
import { adminSetupRoutes } from '../src/routes/admin/setup.js';
import { adminLoginRoutes } from '../src/routes/admin/login.js';
import * as settings from '../src/lib/settings.js';
import { createSession, listSessions, SESSION_COOKIE } from '../src/lib/adminAuth.js';
import { db } from '../src/db/index.js';

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

// Seed: bootstrap admin password so we can issue sessions for the tests.
beforeAll(async () => {
  if (!settings.get('admin_password_hash')) {
    const { bootstrapPassword } = await import('../src/lib/adminAuth.js');
    await bootstrapPassword('hunter2hunter2');
  }
});

function asAdmin() {
  const sid = createSession('admin@example.com', '127.0.0.1', 'curl/test');
  return `${SESSION_COOKIE}=${sid}`;
}

describe('schema migration is idempotent', () => {
  it('admin_sessions has ip and user_agent columns', () => {
    const cols = db.prepare(`PRAGMA table_info(admin_sessions)`).all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('ip');
    expect(names).toContain('user_agent');
  });

  it('createSession persists ip and user_agent', () => {
    const sid = createSession('migration-test@x.com', '203.0.113.7', 'Mozilla/5.0');
    const rows = listSessions('migration-test@x.com');
    expect(rows.length).toBe(1);
    expect(rows[0].ip).toBe('203.0.113.7');
    expect(rows[0].user_agent).toBe('Mozilla/5.0');
    expect(rows[0].id).toBe(sid);
  });
});

describe('variation cookie', () => {
  it('POST /admin/variation sets the cookie and redirects', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/admin/variation',
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'v=narrative',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin');
    const c = r.cookies.find((x) => x.name === 'admin_variation');
    expect(c?.value).toBe('narrative');
  });

  it('GET /admin honors the variation cookie', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin',
      headers: { cookie: `${asAdmin()}; admin_variation=narrative` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('top of pack');
    expect(r.body).toContain('cohort funnel');
  });
});

describe('search + stuck-only filter', () => {
  it('GET /admin?q=&stuck=1 narrows the rendered roster', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin?q=nobody-matches-zzz&stuck=1',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('no operators match the filter');
  });
});

describe('JSON API auth', () => {
  it('returns 401 without admin session', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/admin/api/events' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('unauthorized');
  });

  it('returns 200 with admin session', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/api/events?since=0',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('events');
    expect(Array.isArray(r.json().events)).toBe(true);
  });
});

describe('events polling respects since', () => {
  it('returns only rows with id > since', async () => {
    db.prepare(`INSERT INTO events (kind, payload) VALUES ('attempt', 'a'), ('attempt', 'b'), ('attempt', 'c')`).run();
    const max = (db.prepare(`SELECT MAX(id) AS m FROM events`).get() as { m: number }).m;
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/admin/api/events?since=${max - 1}`,
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    const events = r.json().events as { id: number }[];
    expect(events.every((e) => e.id > max - 1)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('player drawer JSON', () => {
  it('returns 404 for unknown user', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/api/player/99999',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(404);
  });

  it('returns shape for a real user', async () => {
    db.prepare(`INSERT INTO users (email, alias, flag_salt) VALUES ('drawer@x.com', 'drawer_test', 'salt-aaa')`).run();
    const u = db.prepare(`SELECT id FROM users WHERE alias = 'drawer_test'`).get() as { id: number };
    db.prepare(`INSERT INTO user_progress (user_id, current_ordinal) VALUES (?, 3)`).run(u.id);
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/admin/api/player/${u.id}`,
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.id).toBe(u.id);
    expect(j.alias).toBe('drawer_test');
    expect(j.stage).toBe(3);
    expect(j.flagSaltPrefix).toMatch(/^salt-aaa/);
    expect(Array.isArray(j.recentAttempts)).toBe(true);
    expect(j.currentChallenge).toBeTruthy();
    expect(j.currentChallenge.id).toBeTruthy();
  });
});

describe('session revoke', () => {
  it('deletes the targeted session', async () => {
    const sid = createSession('revoke@x.com', '127.0.0.1', 'curl');
    expect(listSessions('revoke@x.com').length).toBeGreaterThanOrEqual(1);
    // The revoke endpoint runs under the *admin's* preHandler in setup plugin.
    // We use the canonical admin@example.com session to authenticate the call.
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/admin/account/sessions/${sid}/revoke`,
      headers: { cookie: asAdmin(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(r.statusCode).toBe(302);
    const live = listSessions('revoke@x.com').filter((s) => s.id === sid);
    expect(live.length).toBe(0);
  });
});
