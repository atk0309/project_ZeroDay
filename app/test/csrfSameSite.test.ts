// Same-site CSRF defense tests — admin POST routes must reject cross-origin
// requests even when a valid admin_session cookie is attached.
//
// SameSite=Strict on admin_session does NOT block requests from sibling
// subdomains under the same registrable domain (e.g. staging.example.com →
// hack.example.com), so the cookie alone is not a sufficient CSRF defense.
// `rejectIfCrossOrigin` (in middleware/adminAuthMiddleware.ts) compares the
// Origin/Referer host against the request's Host and 403s on mismatch.

import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applySchema } from './helpers.js';
import { adminLoginRoutes } from '../src/routes/admin/login.js';
import { adminSetupRoutes } from '../src/routes/admin/setup.js';
import { adminDashboardRoutes } from '../src/routes/admin/dashboard.js';
import { adminTemplatesRoutes } from '../src/routes/admin/templates.js';
import { inviteRoutes } from '../src/routes/admin/invitations.js';
import * as settings from '../src/lib/settings.js';
import { createSession, SESSION_COOKIE, bootstrapPassword } from '../src/lib/adminAuth.js';

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
  await app.register(inviteRoutes);
  return app;
}

beforeAll(() => applySchema());
beforeAll(async () => {
  if (!settings.get('admin_password_hash')) {
    await bootstrapPassword('hunter2hunter2');
  }
});

function asAdminCookie() {
  const sid = createSession('admin@example.com', '127.0.0.1', 'curl/test');
  return `${SESSION_COOKIE}=${sid}`;
}

const FORM = 'application/x-www-form-urlencoded';

describe('same-site CSRF defense on admin routes', () => {
  it('rejects POST /admin/account/password with cross-origin Origin header', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/account/password',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'https://staging.example.com',
        'content-type': FORM,
      },
      payload: 'current_password=hunter2hunter2&new_password=zzzzzzzz9&confirm_password=zzzzzzzz9',
    });
    expect(r.statusCode).toBe(403);
    // Confirm the password did NOT change — verifyPassword still accepts the original.
    const { verifyPassword } = await import('../src/lib/adminAuth.js');
    expect(await verifyPassword('admin@example.com', 'hunter2hunter2')).toBe(true);
  });

  it('rejects POST /admin/account/mail with cross-origin Origin header', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const before = settings.get('admin_email');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/account/mail',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'https://staging.example.com',
        'content-type': FORM,
      },
      payload: 'provider=resend&resend_api_key=x&mail_from=x@x&admin_email=attacker@example.com',
    });
    expect(r.statusCode).toBe(403);
    // admin_email did not change.
    expect(settings.get('admin_email')).toBe(before);
  });

  it('rejects POST /admin/api/invitations with cross-origin Origin header (JSON 403)', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/api/invitations',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'https://staging.example.com',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ inviter_id: null, invitee_email: 'x@x', source: 'admin_override' }),
    });
    expect(r.statusCode).toBe(403);
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('rejects POST /admin/players/templates with cross-origin Referer', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/players/templates',
      headers: {
        cookie,
        host: 'hack.example.com',
        // No Origin — falls through to Referer check.
        referer: 'https://staging.example.com/evil.html',
        'content-type': FORM,
      },
      payload: 'recruit_email_body=pwned',
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects POST /admin/hint with cross-origin Origin header', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/hint',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'https://wopr.example.com',
        'content-type': FORM,
      },
      payload: 'user_id=1&challenge_id=dns-whispers&level=1&body=phishing',
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects POST /admin/login with cross-origin Origin', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: {
        host: 'hack.example.com',
        origin: 'https://staging.example.com',
        'content-type': FORM,
      },
      payload: 'mode=password&email=admin@example.com&password=whatever',
    });
    expect(r.statusCode).toBe(403);
  });

  it('accepts same-origin POST (Origin host matches Host)', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/account/mail',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'https://hack.example.com',
        'content-type': FORM,
      },
      payload: 'provider=resend&resend_api_key=k&mail_from=ops@example.com&admin_email=admin@example.com',
    });
    // Renders the mail page (200) — distinct from the 403 cross-origin path.
    expect(r.statusCode).toBe(200);
  });

  it('rejects when Origin is the literal string "null" (sandboxed iframe / opaque)', async () => {
    const app = await buildApp();
    const cookie = asAdminCookie();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/account/password',
      headers: {
        cookie,
        host: 'hack.example.com',
        origin: 'null',
        'content-type': FORM,
      },
      payload: 'current_password=hunter2hunter2&new_password=zzzzzzzz9&confirm_password=zzzzzzzz9',
    });
    expect(r.statusCode).toBe(403);
  });
});
