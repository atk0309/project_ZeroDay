// Admin console — dedicated full-page screens reachable from the sidenav.
// Covers: /admin/players, /admin/feed, /admin/hints, /manual.

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
import { adminTemplatesRoutes } from '../src/routes/admin/templates.js';
import { adminLoginRoutes } from '../src/routes/admin/login.js';
import { hubRoutes } from '../src/routes/hub.js';
import * as settings from '../src/lib/settings.js';
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
  await app.register(adminTemplatesRoutes);
  await app.register(adminDashboardRoutes);
  await app.register(hubRoutes);
  return app;
}

beforeAll(() => applySchema());

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

describe('admin sidenav screens — auth gate', () => {
  it('GET /admin/players without admin session redirects to /admin/login', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/admin/players' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/login');
  });

  it('GET /admin/feed without admin session redirects to /admin/login', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/admin/feed' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/login');
  });

  it('GET /admin/hints without admin session redirects to /admin/login', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/admin/hints' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/login');
  });
});

describe('admin sidenav screens — render with admin session', () => {
  it('GET /admin/players renders roster tab with sidenav active highlight', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('cohort histogram');
    expect(r.body).toContain('operators · roster');
    // tab strip + sidenav highlight
    expect(r.body).toContain('href="/admin/players?tab=invitations"');
    expect(r.body).toContain('href="/admin/players?tab=requests"');
    expect(r.body).toContain('href="/admin/players?tab=emails"');
  });

  it('GET /admin/players?tab=invitations renders the live funnel', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players?tab=invitations',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('invitation funnel');
    expect(r.body).toContain('admin override');
  });

  it('GET /admin/players?tab=emails renders the editable templates workspace', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players?tab=emails',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('email templates · operator-editable');
    expect(r.body).toContain('name="recruit_email_body"');
    expect(r.body).toContain('name="invite_email_body"');
    expect(r.body).toContain('name="accept_confirm_email_body"');
    expect(r.body).toContain('name="request_received_email_body"');
    expect(r.body).toContain('name="request_approved_email_body"');
    expect(r.body).toContain('name="request_denied_email_body"');
    expect(r.body).toContain('name="lobby_flavor"');
    expect(r.body).toContain('data-template-preview');
    expect(r.body).toContain('data-template-test-send');
    expect(r.body).toContain('action="/admin/players/templates"');
  });

  it('POST /admin/players/templates persists fields and redirects with saved=1', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/players/templates',
      headers: {
        cookie: asAdmin(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'recruit_email_body=hello+%7Balias%7D&invite_email_subject=hi+%7Binviter_alias%7D',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/players?tab=emails&saved=1');
    expect(settings.get('recruit_email_body')).toBe('hello {alias}');
    expect(settings.get('invite_email_subject')).toBe('hi {inviter_alias}');
  });

  it('GET /admin/players?tab=emails&saved=1 surfaces the ✓ saved chip', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players?tab=emails&saved=1',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('✓ saved');
  });

  it('GET /admin/players?tab=emails without saved flag does not show the chip', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players?tab=emails',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('✓ saved');
  });

  it('GET /admin/players/templates/preview renders against sample tokens server-side', async () => {
    const app = await buildApp();
    settings.set('accept_confirm_email_subject', 'welcome {alias}');
    settings.set('accept_confirm_email_body', 'slot #{slot_number} · {inviter_alias}');
    const r = await app.inject({
      method: 'GET', url: '/admin/players/templates/preview?key=accept_confirm',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    const out = JSON.parse(r.body);
    expect(out.subject).toBe('welcome crash.overr');
    expect(out.body).toContain('slot #042 · morpheus');
    expect(out.from).toBeDefined();
    expect(out.to).toBeDefined();
  });

  it('GET /admin/players/templates/preview rejects unknown keys', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/players/templates/preview?key=bogus',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST /admin/players/templates/test-send returns 412 when mail is offline', async () => {
    const app = await buildApp();
    settings.set('mail_configured', 'false');
    const r = await app.inject({
      method: 'POST', url: '/admin/players/templates/test-send',
      headers: {
        cookie: asAdmin(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'key=invite',
    });
    expect(r.statusCode).toBe(412);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('mail');
  });

  it('GET /admin/setup?section=content redirects to the new templates workspace', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/setup?section=content',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/players?tab=emails');
  });

  it('GET /admin/feed renders telemetry strip + log + side rail', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/feed',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('events / min');
    expect(r.body).toContain('event_stream');
    expect(r.body).toContain('top emitters');
    expect(r.body).toContain('kind legend');
  });

  it('GET /admin/hints renders queue health + split-pane', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin/hints',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('awaiting approval');
    expect(r.body).toContain('auto-drip cron');
    expect(r.body).toContain('level costs');
  });

  it('GET /admin (dashboard) trims player table to top 5 + links to /admin/players', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/admin',
      headers: { cookie: asAdmin() },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('recently active · top 5');
    expect(r.body).toContain('href="/admin/players"');
  });
});

describe('public manual route', () => {
  it('GET /manual renders narrative briefing with no auth required', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/manual' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('so you got the email');
    expect(r.body).toContain('what this is');
    expect(r.body).toContain('your handle');
    expect(r.body).toContain('etiquette');
  });
});
