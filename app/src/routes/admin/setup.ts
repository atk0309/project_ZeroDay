// /admin/setup — first-run wizard, also reachable any time post-init.
// Game-launch concerns only: timing, recruit content, review.
// Mail config + admin password live under /admin/account (operator-owned, not
// part of the launch checklist).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as settings from '../../lib/settings.js';
import * as mail from '../../lib/mail.js';
import { audit } from '../../lib/audit.js';
import { changePassword, verifyPassword, listSessions, destroySession, destroyOtherSessions, SESSION_COOKIE } from '../../lib/adminAuth.js';
import { requireAdmin } from '../../middleware/adminAuthMiddleware.js';
import { phaseState } from '../../lib/phase.js';
import { challenges } from '../../challenges/registry.js';
import { authoredChallengeIds } from '../../challenges/handlers/index.js';
import { gibsonKeyStatus } from '../../lib/gibson.js';

interface AdminReq extends FastifyRequest {
  adminEmail?: string;
}

const VALID_SECTIONS = new Set(['timing', 'review']);
const VALID_ACCOUNT_SECTIONS = new Set(['password', 'mail']);

function pickSection(req: FastifyRequest): string {
  const q = (req.query as Record<string, string | undefined>)?.section ?? '';
  return VALID_SECTIONS.has(q) ? q : 'timing';
}

function pickAccountSection(req: FastifyRequest): string {
  const q = (req.query as Record<string, string | undefined>)?.section ?? '';
  return VALID_ACCOUNT_SECTIONS.has(q) ? q : 'password';
}

// Common locals for every render of admin/setup.ejs. Anything view-wide goes
// here so individual route handlers don't have to remember to inject it.
function setupDefaults() {
  return {
    settings: settings.getAll(),
    mailConfigured: mail.isConfigured(),
    authoredIds: authoredChallengeIds(),
    totalChallenges: challenges.length,
    gibsonKey: gibsonKeyStatus(),
    phase: phaseState().phase,
  };
}

export async function adminSetupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/admin/setup') && !req.url.startsWith('/admin/account')) return;
    await requireAdmin(req, reply);
  });

  app.get('/admin/setup', async (req, reply) => {
    // Recruit/invite content moved to /admin/players?tab=emails. Redirect any
    // surviving bookmarks so deep-links don't 404 into a dead section.
    const q = (req.query as Record<string, string | undefined>) ?? {};
    if (q.section === 'content') return reply.redirect('/admin/players?tab=emails');
    return reply.view('admin/setup.ejs', {
      ...setupDefaults(),
      message: null,
      active: pickSection(req),
      savedFlash: '',
    });
  });

  // Game timing.
  app.post('/admin/setup/timing', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const launch = (body.launch_at ?? '').trim();
    const end = (body.end_at ?? '').trim();
    const tz = (body.timezone ?? '').trim();

    const launchDate = new Date(launch);
    const endDate = new Date(end);
    if (Number.isNaN(launchDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return reply.view('admin/setup.ejs', { ...setupDefaults(), active: 'timing', savedFlash: '', message: 'invalid date(s)' });
    }
    if (endDate <= launchDate) {
      return reply.view('admin/setup.ejs', { ...setupDefaults(), active: 'timing', savedFlash: '', message: 'end_at must be after launch_at' });
    }
    settings.setMany({
      launch_at: launchDate.toISOString(),
      end_at: endDate.toISOString(),
    });
    audit(req.adminEmail!, 'config_change', 'timing', { launch_at: launchDate.toISOString(), end_at: endDate.toISOString(), tz }, req.ip);
    return reply.view('admin/setup.ejs', {
      ...setupDefaults(),
      message: 'timing saved · cache invalidated',
      active: 'timing',
      savedFlash: 'timing',
    });
  });

  // Legacy compat: the editor moved to /admin/players?tab=emails (POSTs to
  // /admin/players/templates). Bookmarked submitters land on the new page.
  app.post('/admin/setup/content', async (_req, reply) => {
    return reply.redirect('/admin/players?tab=emails');
  });

  // Change password (post-init) — kept for compat with prior bookmarks.
  app.post('/admin/setup/password', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const newPw = body.new_password ?? '';
    const confirm = body.confirm_password ?? '';
    if (newPw.length < 8 || newPw !== confirm) {
      return reply.view('admin/setup.ejs', {
        ...setupDefaults(),
        message: 'password must be 8+ chars and match',
        active: 'timing',
        savedFlash: '',
      });
    }
    await changePassword(newPw);
    audit(req.adminEmail!, 'set_password', null, { via: 'setup' }, req.ip);
    return reply.view('admin/setup.ejs', {
      ...setupDefaults(),
      message: 'password updated',
      active: 'timing',
      savedFlash: '',
    });
  });

  // ── Account (standalone) ─────────────────────────────────────
  // Operator-owned settings: password rotation, sessions, and mail subsystem.
  // Mail lives here (not /admin/setup) because it's a system-level concern, not
  // a launch-checklist item.
  app.get('/admin/account', async (req: AdminReq, reply) => {
    const adminEmail = req.adminEmail ?? settings.get('admin_email') ?? '';
    const currentSid = req.cookies?.[SESSION_COOKIE] ?? null;
    const sessions = adminEmail ? listSessions(adminEmail) : [];
    return reply.view('admin/account.ejs', {
      adminEmail,
      message: null,
      success: false,
      sessions,
      currentSid,
      active: pickAccountSection(req),
      settings: settings.getAll(),
      mailConfigured: mail.isConfigured(),
      savedFlash: '',
    });
  });

  // Mail subsystem (moved from /admin/setup/mail).
  app.post('/admin/account/mail', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const provider = (body.provider ?? '').trim();
    const from = (body.mail_from ?? '').trim();
    const adminEmailFld = (body.admin_email ?? '').trim();
    const adminEmail = req.adminEmail ?? settings.get('admin_email') ?? '';
    const currentSid = req.cookies?.[SESSION_COOKIE] ?? null;
    const sessions = adminEmail ? listSessions(adminEmail) : [];

    const baseView = {
      adminEmail,
      sessions,
      currentSid,
      active: 'mail',
      settings: settings.getAll(),
      mailConfigured: mail.isConfigured(),
      success: false,
      savedFlash: '',
    };

    let creds: object;
    if (provider === 'resend') {
      creds = { apiKey: body.resend_api_key ?? '' };
    } else if (provider === 'smtp') {
      creds = {
        host: body.smtp_host ?? '',
        port: Number.parseInt(body.smtp_port ?? '587', 10),
        secure: body.smtp_secure === 'on',
        user: body.smtp_user ?? '',
        pass: body.smtp_pass ?? '',
      };
    } else {
      return reply.view('admin/account.ejs', { ...baseView, message: 'unknown provider' });
    }

    settings.setMany({
      mail_provider: provider,
      mail_credentials: JSON.stringify(creds),
      mail_from: from || 'recruit@example.com',
      mail_configured: 'false', // unverified until test-send succeeds
      admin_email: adminEmailFld || settings.get('admin_email') || 'admin@example.com',
    });
    audit(req.adminEmail!, 'config_change', 'mail', { provider, from, admin_email: adminEmailFld }, req.ip);
    return reply.view('admin/account.ejs', {
      ...baseView,
      settings: settings.getAll(),
      mailConfigured: false,
      message: 'mail config saved — send a test to verify',
      savedFlash: 'mail',
    });
  });

  // Test-send. Flips mail_configured = true on success.
  app.post('/admin/account/mail/test', async (req: AdminReq, reply) => {
    const adminEmail = req.adminEmail ?? settings.get('admin_email') ?? '';
    const currentSid = req.cookies?.[SESSION_COOKIE] ?? null;
    const sessions = adminEmail ? listSessions(adminEmail) : [];
    const targetEmail = settings.get('admin_email');

    const baseView = {
      adminEmail,
      sessions,
      currentSid,
      active: 'mail',
      success: false,
    };

    if (!targetEmail) {
      return reply.view('admin/account.ejs', {
        ...baseView,
        settings: settings.getAll(),
        mailConfigured: false,
        message: 'no admin email configured',
        savedFlash: '',
      });
    }
    const r = await mail.sendTest(targetEmail);
    if (r.ok) {
      settings.set('mail_configured', 'true');
      audit(req.adminEmail!, 'send_test_mail', targetEmail, { ok: true, provider: r.provider, id: r.id }, req.ip);
      return reply.view('admin/account.ejs', {
        ...baseView,
        settings: settings.getAll(),
        mailConfigured: true,
        message: `test mail sent via ${r.provider}`,
        savedFlash: 'mail',
      });
    }
    audit(req.adminEmail!, 'send_test_mail', targetEmail, { ok: false, error: r.error }, req.ip);
    return reply.view('admin/account.ejs', {
      ...baseView,
      settings: settings.getAll(),
      mailConfigured: false,
      message: `test failed: ${r.error}`,
      savedFlash: '',
    });
  });

  // Revoke a specific session.
  app.post('/admin/account/sessions/:id/revoke', async (req: AdminReq, reply) => {
    const id = (req.params as Record<string, string>).id;
    const currentSid = req.cookies?.[SESSION_COOKIE] ?? null;
    if (!id) return reply.code(400).send({ error: 'bad id' });
    if (id === currentSid) {
      // Self-revoke = logout. Clear cookie and redirect to login.
      destroySession(id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      audit(req.adminEmail!, 'session_revoke', id, { self: true }, req.ip);
      return reply.redirect('/admin/login');
    }
    destroySession(id);
    audit(req.adminEmail!, 'session_revoke', id, { self: false }, req.ip);
    return reply.redirect('/admin/account');
  });

  app.post('/admin/account/password', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const current = body.current_password ?? '';
    const newPw = body.new_password ?? '';
    const confirm = body.confirm_password ?? '';
    const adminEmail = req.adminEmail ?? settings.get('admin_email') ?? '';

    const currentSid = req.cookies?.[SESSION_COOKIE] ?? '';
    const sessions = adminEmail ? listSessions(adminEmail) : [];
    const renderError = (msg: string) =>
      reply.view('admin/account.ejs', {
        adminEmail,
        message: msg,
        success: false,
        sessions,
        currentSid,
        active: 'password',
        settings: settings.getAll(),
        mailConfigured: mail.isConfigured(),
        savedFlash: '',
      });

    if (newPw.length < 8) return renderError('new password must be at least 8 characters');
    if (newPw !== confirm) return renderError('passwords do not match');
    if (!adminEmail) return renderError('no admin email on record');
    const ok = await verifyPassword(adminEmail, current);
    if (!ok) {
      audit(adminEmail, 'set_password_fail', null, { reason: 'bad_current' }, req.ip);
      return renderError('current password is incorrect');
    }
    await changePassword(newPw);
    const ended = currentSid ? destroyOtherSessions(adminEmail, currentSid) : 0;
    audit(adminEmail, 'set_password', null, { via: 'account', sessions_ended: ended }, req.ip);
    return reply.view('admin/account.ejs', {
      adminEmail,
      message: `password rotated · ${ended} other session${ended === 1 ? '' : 's'} ended`,
      success: true,
      sessions: listSessions(adminEmail),
      currentSid,
      active: 'password',
      settings: settings.getAll(),
      mailConfigured: mail.isConfigured(),
      savedFlash: '',
    });
  });
}
