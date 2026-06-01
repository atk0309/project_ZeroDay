// Tests the admin-auth state machine and the 5-click bootstrap easter egg.
// We exercise the route handler via Fastify's inject() so we cover the full
// cookie/session cycle.

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
import { issueMagicLink } from '../src/lib/adminAuth.js';
import * as settings from '../src/lib/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

async function buildAdminApp() {
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
  return app;
}

beforeAll(() => applySchema());

describe('admin login + bootstrap easter egg', () => {
  it('starts in uninitialized state', () => {
    settings.set('admin_password_hash', null);
    expect(settings.get('admin_password_hash')).toBeNull();
  });

  it('first 4 empty-field clicks just complain; 5th morphs to set-password', async () => {
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 4; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('missing credentials');
      expect(r.body).not.toContain('set new admin password');
      const setCookie = r.cookies.find((c) => c.name === 'admin_login_clicks');
      if (setCookie) cookies = `admin_login_clicks=${setCookie.value}`;
    }
    const fifth = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=password&email=&password=',
    });
    expect(fifth.statusCode).toBe(200);
    expect(fifth.body).toContain('set new admin password');
  });

  it('typing in either field resets the click counter', async () => {
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 3; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      const c = r.cookies.find((c) => c.name === 'admin_login_clicks');
      if (c) cookies = `admin_login_clicks=${c.value}`;
    }
    // Type something — counter should reset.
    const typed = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=password&email=admin@x&password=wrong',
    });
    // Now empty clicks should restart from 1.
    cookies = '';
    for (let i = 1; i <= 4; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      const c = r.cookies.find((c) => c.name === 'admin_login_clicks');
      if (c) cookies = `admin_login_clicks=${c.value}`;
      // None of these four should morph (counter reset before this loop).
      expect(r.body).not.toContain('set new admin password');
    }
    expect(typed).toBeDefined(); // sanity
  });

  it('bootstrap submit with a forged unsigned arm cookie is refused', async () => {
    // Regression for codex P1: the arm cookie must be signed so an attacker
    // can't bypass the gate by sending `Cookie: admin_bootstrap_ready=1`
    // directly. Without signature verification the new bootstrap gate is
    // purely decorative.
    settings.set('admin_password_hash', null);
    const app = await buildAdminApp();
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: {
        cookie: 'admin_bootstrap_ready=1; admin_login_clicks=5',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'mode=bootstrap&new_password=hunter2hunter2&confirm_password=hunter2hunter2',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('bootstrap not armed');
    expect(settings.get('admin_password_hash')).toBeNull();
  });

  it('bootstrap submit without the easter-egg arm cookie is refused', async () => {
    // Regression for the unauthenticated direct-bootstrap takeover: the click
    // counter is UI-only, so the server must require a separately armed cookie
    // (set on the 5th clean empty click) before letting mode=bootstrap write
    // the first admin password.
    settings.set('admin_password_hash', null);
    const app = await buildAdminApp();
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=bootstrap&new_password=hunter2hunter2&confirm_password=hunter2hunter2',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('bootstrap not armed');
    expect(settings.get('admin_password_hash')).toBeNull();
  });

  it('bootstrap submit after five empty clicks sets password and redirects', async () => {
    settings.set('admin_password_hash', null);
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      const click = r.cookies.find((c) => c.name === 'admin_login_clicks');
      const armed = r.cookies.find((c) => c.name === 'admin_bootstrap_ready');
      const jar = [
        click ? `admin_login_clicks=${click.value}` : null,
        armed ? `admin_bootstrap_ready=${armed.value}` : null,
      ].filter(Boolean) as string[];
      cookies = jar.join('; ');
    }
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=bootstrap&new_password=hunter2hunter2&confirm_password=hunter2hunter2',
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin/setup');
    expect(settings.get('admin_password_hash')).toBeTruthy();
  });

  it('typing in either field disarms the bootstrap-ready cookie', async () => {
    // After arming, a stray keystroke in email/password should clear the
    // arm cookie so a follow-up bootstrap submit is refused.
    settings.set('admin_password_hash', null);
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      const click = r.cookies.find((c) => c.name === 'admin_login_clicks');
      const armed = r.cookies.find((c) => c.name === 'admin_bootstrap_ready');
      const jar = [
        click ? `admin_login_clicks=${click.value}` : null,
        armed ? `admin_bootstrap_ready=${armed.value}` : null,
      ].filter(Boolean) as string[];
      cookies = jar.join('; ');
    }
    // Stray keystroke — the route blocks because state===uninitialized but
    // also clears the arm cookie defensively.
    const typed = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=password&email=admin@x&password=anything',
    });
    const cleared = typed.cookies.find((c) => c.name === 'admin_bootstrap_ready');
    // The cookie is cleared by setting an expired value.
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe('');
    // Drop the arm cookie from the jar to mimic the browser obeying the clear.
    const click = typed.cookies.find((c) => c.name === 'admin_login_clicks');
    cookies = click ? `admin_login_clicks=${click.value}` : '';
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=bootstrap&new_password=hunter2hunter2&confirm_password=hunter2hunter2',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('bootstrap not armed');
    expect(settings.get('admin_password_hash')).toBeNull();
  });

  it('bootstrap finalizer arms password for downstream tests', async () => {
    settings.set('admin_password_hash', null);
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      const click = r.cookies.find((c) => c.name === 'admin_login_clicks');
      const armed = r.cookies.find((c) => c.name === 'admin_bootstrap_ready');
      const jar = [
        click ? `admin_login_clicks=${click.value}` : null,
        armed ? `admin_bootstrap_ready=${armed.value}` : null,
      ].filter(Boolean) as string[];
      cookies = jar.join('; ');
    }
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=bootstrap&new_password=hunter2hunter2&confirm_password=hunter2hunter2',
    });
    expect(r.statusCode).toBe(302);
    expect(settings.get('admin_password_hash')).toBeTruthy();
  });

  it('once initialized, 10 empty-field clicks never morph', async () => {
    // Ensure password is set from the previous test.
    expect(settings.get('admin_password_hash')).toBeTruthy();
    const app = await buildAdminApp();
    let cookies = '';
    for (let i = 1; i <= 10; i++) {
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=&password=',
      });
      expect(r.body).not.toContain('set new admin password');
      const c = r.cookies.find((c) => c.name === 'admin_login_clicks');
      if (c) cookies = `admin_login_clicks=${c.value}`;
    }
  });

  it('bootstrap is refused once a password exists', async () => {
    const app = await buildAdminApp();
    const r = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=bootstrap&new_password=secondtry1&confirm_password=secondtry1',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('already initialized');
  });

  it('magic-link submit with mail offline reports the offline state, not "unknown mode"', async () => {
    // Regression: prior view had two `name=mode` inputs (hidden=password +
    // button=magic). fastify-formbody parsed that as an array, dropping the
    // request into the route's catch-all `unknown mode` 400. The streamlined
    // view ships a single hidden mode input, but the route also normalizes
    // arrays defensively — both submission shapes should resolve cleanly.
    const app = await buildAdminApp();
    const single = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=magic&email=admin@example.com',
    });
    expect(single.statusCode).toBe(200);
    expect(single.body).not.toContain('unknown mode');
    expect(single.body).toContain('mail subsystem offline');

    // Belt-and-suspenders: a duplicated `mode` field still resolves (last wins).
    const duped = await app.inject({
      method: 'POST', url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'mode=password&mode=magic&email=admin@example.com',
    });
    expect(duped.statusCode).toBe(200);
    expect(duped.body).not.toContain('unknown mode');
    expect(duped.body).toContain('mail subsystem offline');
  });

  it('initialized login screen renders the streamlined magic-first layout when mail is configured', async () => {
    settings.set('mail_configured', 'true');
    settings.set('mail_provider', 'resend');
    settings.set('mail_credentials', JSON.stringify({ apiKey: 'test' }));
    settings.set('mail_from', 'test@example.com');
    try {
      const app = await buildAdminApp();
      const r = await app.inject({ method: 'GET', url: '/admin/login' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('login-streamlined');
      expect(r.body).toContain('[ send magic link ]');
      expect(r.body).toContain('use password instead');
      // Codex P1: the toggle must be a real anchor so the password path is
      // reachable when the JS intercept doesn't run (CSP, extension breakage,
      // text browser). Without this, a stale mail_configured=true + a real
      // mail outage locks admins out.
      expect(r.body).toContain('href="/admin/login?fallback=password"');
    } finally {
      settings.set('mail_configured', null);
      settings.set('mail_provider', null);
      settings.set('mail_credentials', null);
      settings.set('mail_from', null);
    }
  });

  it('?fallback=password renders the streamlined card with password mode pre-selected', async () => {
    settings.set('mail_configured', 'true');
    settings.set('mail_provider', 'resend');
    settings.set('mail_credentials', JSON.stringify({ apiKey: 'test' }));
    settings.set('mail_from', 'test@example.com');
    try {
      const app = await buildAdminApp();
      const r = await app.inject({ method: 'GET', url: '/admin/login?fallback=password' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('login-streamlined');
      // Hidden mode input is set to password at server-render time. Match the
      // rendered input element specifically so the script literals don't satisfy.
      expect(r.body).toMatch(/<input type="hidden" name="mode" id="login-mode" value="password"/);
      // Primary button reads "[ login ]" at render time. Use a regex anchored to
      // the primary-btn id so the string inside the inline <script> doesn't
      // satisfy the assertion either way.
      expect(r.body).toMatch(/id="primary-btn"[^>]*>\s*\[ login \]/);
      expect(r.body).not.toMatch(/id="primary-btn"[^>]*>\s*\[ send magic link \]/);
      // Password field is rendered without the `hidden` attribute so it's
      // immediately fillable by no-JS users.
      expect(r.body).toMatch(/<div id="password-field"\s*>/);
      // Toggle now points back to magic mode.
      expect(r.body).toMatch(/id="toggle-mode" href="\/admin\/login"/);
      expect(r.body).toContain('use magic link');
    } finally {
      settings.set('mail_configured', null);
      settings.set('mail_provider', null);
      settings.set('mail_credentials', null);
      settings.set('mail_from', null);
    }
  });

  it('admin magic-link consume sets a SameSite=Lax session cookie', async () => {
    // Regression: SameSite=Strict made magic-link auth appear broken. Click
    // from a mailbox is a cross-site top-level navigation; the 302 → /admin
    // runs inside the same nav chain, so a Strict cookie was stored but not
    // sent on the redirect, and the user landed back on /admin/login. Lax
    // keeps CSRF protection on POSTs while letting top-level GETs carry the
    // cookie — which is exactly what magic-link follow-through needs.
    settings.set('admin_email', 'admin@example.com');
    const token = issueMagicLink('admin@example.com');
    const app = await buildAdminApp();
    const r = await app.inject({ method: 'GET', url: `/admin/login?token=${token}` });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/admin');
    const sessionCookie = r.cookies.find((c) => c.name === 'admin_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.sameSite?.toLowerCase()).toBe('lax');
  });

  it('failed password submit re-renders in password mode (not snapping back to magic)', async () => {
    settings.set('mail_configured', 'true');
    settings.set('mail_provider', 'resend');
    settings.set('mail_credentials', JSON.stringify({ apiKey: 'test' }));
    settings.set('mail_from', 'test@example.com');
    try {
      const app = await buildAdminApp();
      const r = await app.inject({
        method: 'POST', url: '/admin/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=password&email=admin@example.com&password=wrong',
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('access denied');
      // The re-render should show the password variant, not magic. Anchor the
      // assertions to the primary button so the inline <script>'s string
      // literals don't false-match either way.
      expect(r.body).toMatch(/id="primary-btn"[^>]*>\s*\[ login \]/);
      expect(r.body).not.toMatch(/id="primary-btn"[^>]*>\s*\[ send magic link \]/);
    } finally {
      settings.set('mail_configured', null);
      settings.set('mail_provider', null);
      settings.set('mail_credentials', null);
      settings.set('mail_from', null);
    }
  });
});
