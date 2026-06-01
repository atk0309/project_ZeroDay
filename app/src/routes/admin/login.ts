// /admin/login — three jobs:
//  1. Normal post-init login (email + password OR magic link).
//  2. Bootstrap easter egg: 5 consecutive empty-field clicks on [ login ] while
//     no admin password is set morphs the screen to "set new admin password".
//  3. Magic-link consumption (?token=...).
//
// The easter-egg click counter lives in a short-lived signed cookie and resets
// the moment the user types anything in either input, so the trigger requires
// deliberate empty clicks.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE,
  adminState,
  bootstrapPassword,
  consumeMagicLink,
  createSession,
  destroySession,
  issueMagicLink,
  verifyPassword,
} from '../../lib/adminAuth.js';
import * as settings from '../../lib/settings.js';
import * as mail from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { rejectIfCrossOrigin } from '../../middleware/adminAuthMiddleware.js';

const CLICK_COOKIE = 'admin_login_clicks';
// Server-issued proof that the 5-click easter egg actually fired in this
// browser. The bootstrap branch refuses to initialize the admin password
// without it, so an unauthenticated attacker can't skip straight to
// `mode=bootstrap` on a fresh deployment.
const BOOTSTRAP_COOKIE = 'admin_bootstrap_ready';
const CLICK_THRESHOLD = 5;

function getClickCount(req: FastifyRequest): number {
  const raw = req.cookies?.[CLICK_COOKIE];
  if (!raw) return 0;
  // Signed-cookie verification — an unsigned/forged value reads as 0 so an
  // attacker can't forge `admin_login_clicks=4` to skip straight to the
  // morph and have the server mint a real arm cookie in one request.
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return 0;
  const n = Number.parseInt(unsigned.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function setClickCount(reply: FastifyReply, n: number) {
  if (n <= 0) {
    reply.clearCookie(CLICK_COOKIE, { path: '/admin' });
    return;
  }
  reply.setCookie(CLICK_COOKIE, String(n), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    signed: true,
    maxAge: 60 * 10, // 10 minutes — long enough to click 5 times, short enough to expire
  });
}

function setBootstrapReady(reply: FastifyReply, ready: boolean) {
  if (!ready) {
    reply.clearCookie(BOOTSTRAP_COOKIE, { path: '/admin' });
    return;
  }
  reply.setCookie(BOOTSTRAP_COOKIE, '1', {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    // Sign so an attacker can't bypass the gate by simply sending
    // `Cookie: admin_bootstrap_ready=1`. Without this the new bootstrap
    // gate is decorative — the raw client-controlled value would be
    // trusted by isBootstrapReady().
    signed: true,
    maxAge: 60 * 5,
  });
}

function isBootstrapReady(req: FastifyRequest): boolean {
  const raw = req.cookies?.[BOOTSTRAP_COOKIE];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === '1';
}

function setSessionCookie(reply: FastifyReply, sid: string) {
  reply.setCookie(SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    // SameSite=Lax (not Strict). Magic-link auth is a cross-site top-level
    // navigation: the click happens in the user's mailbox, then the server's
    // 302 → /admin runs *inside the same cross-site navigation chain*. With
    // Strict the browser stores the new cookie but refuses to send it on
    // that follow-up redirect, so /admin bounces back to /admin/login and
    // the session only "wakes up" once the user navigates fresh from the
    // address bar. Lax keeps CSRF protection on POSTs while letting top-
    // level GETs (which is what magic links are) carry the cookie.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 12,
  });
}

export async function adminLoginRoutes(app: FastifyInstance) {
  // CSRF: reject cross-origin POSTs to login/logout. Even though the
  // bootstrap easter egg is dead post-init, login itself can be a CSRF
  // target (logout, log-the-victim-in attacks, click-counter bumping).
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    if (path !== '/admin/login' && path !== '/admin/logout') return;
    if (rejectIfCrossOrigin(req, reply, 'html')) return reply;
  });

  // GET /admin/login — render. Optional `?token=` consumes a magic link.
  // Optional `?fallback=password` forces the streamlined card into password
  // mode at server-render time, so the password path stays reachable when
  // the client-side toggle JS isn't running (CSP, extension breakage, text
  // browsers). Without this, a stale `mail_configured=true` + a real mail
  // outage would lock admins out.
  app.get('/admin/login', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const tokenQ = query.token;
    const prefer: 'magic' | 'password' = query.fallback === 'password' ? 'password' : 'magic';
    if (tokenQ) {
      const r = consumeMagicLink(tokenQ);
      if (r) {
        const sid = createSession(r.email, req.ip, req.headers['user-agent'] ?? null);
        setSessionCookie(reply, sid);
        audit(r.email, 'login', 'magic_link', null, req.ip);
        return reply.redirect('/admin');
      }
      return reply.view('admin/login.ejs', {
        state: adminState(),
        message: 'magic link expired or already used',
        morph: false,
        clicks: 0,
        magicSent: false,
        prefer,
      });
    }

    return reply.view('admin/login.ejs', {
      state: adminState(),
      message: null,
      morph: false,
      clicks: getClickCount(req),
      magicSent: false,
      prefer,
    });
  });

  // POST /admin/login — handles all three flows depending on the `mode` field.
  // Rate-limited inline (10/min/IP) to throttle admin-password brute-force.
  app.post('/admin/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | string[] | undefined>;
    // Defense in depth: if a future template ever submits `mode` twice, fastify
    // formbody parses it as an array. Pick the last value so a clicked button
    // wins over a hidden default.
    const rawMode = body.mode;
    const mode = Array.isArray(rawMode) ? rawMode[rawMode.length - 1] : (rawMode ?? 'password');
    const emailRaw = body.email;
    const email = (Array.isArray(emailRaw) ? emailRaw[0] : emailRaw ?? '').trim();
    const passwordRaw = body.password;
    const password = Array.isArray(passwordRaw) ? passwordRaw[0] : passwordRaw ?? '';
    const state = adminState();
    // Re-renders should land on the same mode the user submitted, so a
    // failed password attempt stays on the password view (and a failed
    // magic submit stays on the magic view) rather than snapping back to
    // the magic-first default. Bootstrap renders ignore `prefer`.
    const prefer: 'magic' | 'password' = mode === 'password' ? 'password' : 'magic';

    // ----- mode: password -----
    if (mode === 'password') {
      // Easter egg path: empty fields + uninitialized → increment click counter.
      if (state === 'uninitialized' && email === '' && password === '') {
        const next = getClickCount(req) + 1;
        if (next >= CLICK_THRESHOLD) {
          setClickCount(reply, 0);
          setBootstrapReady(reply, true);
          return reply.view('admin/login.ejs', {
            state,
            message: null,
            morph: true,
            clicks: 0,
            magicSent: false,
            prefer,
          });
        }
        setClickCount(reply, next);
        return reply.view('admin/login.ejs', {
          state,
          message: 'missing credentials',
          morph: false,
          clicks: next,
          magicSent: false,
          prefer,
        });
      }

      // Any keystroke means: not a deliberate empty click. Reset counter and
      // disarm the bootstrap cookie — only a clean 5-empty-click run arms it.
      if (email !== '' || password !== '') {
        setClickCount(reply, 0);
        setBootstrapReady(reply, false);
      }

      // Uninitialized but they typed something → still no path in until egg fires.
      if (state === 'uninitialized') {
        return reply.view('admin/login.ejs', {
          state,
          message: 'admin not initialized',
          morph: false,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }

      const ok = await verifyPassword(email, password);
      if (!ok) {
        audit(email || '(blank)', 'login_fail', null, { reason: 'bad_password' }, req.ip);
        return reply.view('admin/login.ejs', {
          state,
          message: 'access denied',
          morph: false,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      const sid = createSession(email, req.ip, req.headers['user-agent'] ?? null);
      setSessionCookie(reply, sid);
      audit(email, 'login', 'password', null, req.ip);
      return reply.redirect('/admin');
    }

    // ----- mode: magic-link -----
    if (mode === 'magic') {
      if (state === 'uninitialized') {
        return reply.view('admin/login.ejs', {
          state,
          message: 'admin not initialized',
          morph: false,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      if (!mail.isConfigured()) {
        return reply.view('admin/login.ejs', {
          state,
          message: 'mail subsystem offline — use password',
          morph: false,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      const adminEmail = settings.get('admin_email');
      if (!adminEmail || email.toLowerCase() !== adminEmail.toLowerCase()) {
        // Don't leak whether the email is correct — same response either way.
        audit(email || '(blank)', 'login_fail', null, { reason: 'bad_email' }, req.ip);
        return reply.view('admin/login.ejs', {
          state,
          message: 'if that address is recognized, a link has been sent',
          morph: false,
          clicks: 0,
          magicSent: true,
          prefer,
        });
      }
      const token = issueMagicLink(adminEmail);
      const origin = process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com';
      const link = `${origin}/admin/login?token=${token}`;
      const r = await mail.send({
        to: adminEmail,
        subject: '[ZeroDay] admin link — 15 min',
        text: `decryption key:\n${link}\n\nexpires in 15 minutes.`,
      });
      audit(adminEmail, r.ok ? 'magic_link_sent' : 'magic_link_fail', null, { provider: r.provider }, req.ip);
      return reply.view('admin/login.ejs', {
        state,
        message: r.ok ? 'transmission sent. check your inbox.' : `mail failed: ${r.error}`,
        morph: false,
        clicks: 0,
        magicSent: r.ok,
        prefer,
      });
    }

    // ----- mode: bootstrap (after the morph) -----
    if (mode === 'bootstrap') {
      if (state !== 'uninitialized') {
        setBootstrapReady(reply, false);
        return reply.view('admin/login.ejs', {
          state,
          message: 'already initialized',
          morph: false,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      // The five-click counter only gates *rendering* the morphed form; without
      // a server-side proof here, an unauthenticated attacker on a fresh
      // deployment can POST mode=bootstrap directly and seize the admin seat
      // before the legitimate operator finishes provisioning. The arm cookie
      // is only set after a clean 5-empty-click run, so requiring it ties
      // bootstrap back to the easter egg the way the docs claim.
      if (!isBootstrapReady(req)) {
        return reply.view('admin/login.ejs', {
          state,
          message: 'bootstrap not armed — hit [ login ] five times with empty fields first',
          morph: false,
          clicks: getClickCount(req),
          magicSent: false,
          prefer,
        });
      }
      const newPasswordRaw = body.new_password;
      const confirmRaw = body.confirm_password;
      const newPassword = Array.isArray(newPasswordRaw) ? newPasswordRaw[0] : newPasswordRaw ?? '';
      const confirm = Array.isArray(confirmRaw) ? confirmRaw[0] : confirmRaw ?? '';
      if (newPassword.length < 8) {
        return reply.view('admin/login.ejs', {
          state,
          message: 'password must be at least 8 characters',
          morph: true,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      if (newPassword !== confirm) {
        return reply.view('admin/login.ejs', {
          state,
          message: 'passwords do not match',
          morph: true,
          clicks: 0,
          magicSent: false,
          prefer,
        });
      }
      const adminEmail = await bootstrapPassword(newPassword);
      setBootstrapReady(reply, false);
      const sid = createSession(adminEmail, req.ip, req.headers['user-agent'] ?? null);
      setSessionCookie(reply, sid);
      audit(adminEmail, 'set_password', null, { via: 'easter_egg' }, req.ip);
      return reply.redirect('/admin/setup');
    }

    return reply.code(400).send({ error: 'unknown mode' });
  });

  // POST /admin/logout
  app.post('/admin/logout', async (req, reply) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    destroySession(sid);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/admin/login');
  });
}
