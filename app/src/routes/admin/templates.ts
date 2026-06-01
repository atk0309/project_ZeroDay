// Operator-editable email + lobby copy. Single workspace at
// /admin/players?tab=emails (rendered by adminDashboardRoutes); this plugin
// owns the writes + the server-rendered preview + the live test-send.
//
// Endpoints:
//   POST /admin/players/templates              save all template fields
//   GET  /admin/players/templates/preview      JSON preview rendered with sample tokens
//   POST /admin/players/templates/test-send    real send to admin email
//
// All mutate routes require an admin session. Preview is GET so the editor
// can hit it while typing without CSRF noise; the rendered output is
// derived from the *saved* template (not whatever's in the textarea), which
// matches how the live system will render it.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as settings from '../../lib/settings.js';
import * as content from '../../lib/content.js';
import * as mail from '../../lib/mail.js';
import * as invitations from '../../lib/invitations.js';
import { audit } from '../../lib/audit.js';
import { SESSION_COOKIE, readSession } from '../../lib/adminAuth.js';
import { rejectIfCrossOrigin } from '../../middleware/adminAuthMiddleware.js';

interface AdminReq extends FastifyRequest { adminEmail?: string }

// Whitelist — every key the editor is allowed to write. Anything else in the
// posted form is silently ignored.
const WRITABLE_KEYS = [
  'recruit_email_body',
  'lobby_flavor',
  'invite_email_subject',
  'invite_email_body',
  'accept_confirm_email_subject',
  'accept_confirm_email_body',
  'request_received_email_subject',
  'request_received_email_body',
  'request_approved_email_subject',
  'request_approved_email_body',
  'request_denied_email_subject',
  'request_denied_email_body',
] as const;

type WritableKey = (typeof WRITABLE_KEYS)[number];

function publicOrigin(): string {
  return process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com';
}

// Sample token packs used by both the preview endpoint and the test-send.
// Kept colocated so an operator hitting "send test" gets the same content
// they saw in the preview pane.
function sampleRecruit(): content.RecruitTokens {
  return {
    alias: 'trinity',
    magic_link: `${publicOrigin()}/auth?token=0xAF21-9C3D-EE77-04B2`,
    expires_in: '15 min',
  };
}

function sampleInvite(): content.InviteTokens {
  return {
    inviter_alias: 'morpheus',
    claim_link: `${publicOrigin()}/claim/zd_aZ12k3p9q5x_sample`,
    expires_in: invitations.expiresInLabel(),
    note: 'study group · two more from northridge',
    note_block: content.inviteNoteBlock('study group · two more from northridge'),
  };
}

function sampleAcceptConfirm(): content.AcceptConfirmTokens {
  return {
    alias: 'crash.overr',
    slot_number: '042',
    inviter_alias: 'morpheus',
    lobby_link: `${publicOrigin()}/`,
  };
}

function sampleRequestReceived(): content.RequestReceivedTokens {
  return {
    requester_alias: 'acid_burn',
    requester_email: 'a.burn@example.net',
    invitee_email: 'j.hartwell@example.com',
    reason: 'study group · two more from northridge',
    admin_link: `${publicOrigin()}/admin/players?tab=requests`,
  };
}

function sampleRequestApproved(): content.RequestApprovedTokens {
  return {
    requester_alias: 'acid_burn',
    invitee_email: 'j.hartwell@example.com',
    note: 'approved · keep them on track',
    note_block: content.adminNoteBlock('approved · keep them on track'),
    lobby_link: `${publicOrigin()}/`,
  };
}

function sampleRequestDenied(): content.RequestDeniedTokens {
  return {
    requester_alias: 'acid_burn',
    invitee_email: 'j.hartwell@example.com',
    note: 'cohort is at capacity for this trial window',
    lobby_link: `${publicOrigin()}/`,
  };
}

// One-stop preview renderer. `key` selects which template family + which
// half (subject vs body). Returns null for unknown keys.
export interface RenderedPreview {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export function renderPreview(key: string): RenderedPreview | null {
  const from = settings.get('mail_from') ?? 'recruit@example.com';
  const adminEmail = settings.get('admin_email') ?? 'admin@example.com';
  switch (key) {
    case 'recruit': {
      const t = sampleRecruit();
      return { from, to: 'trinity@example.net', subject: content.recruitEmailSubject(t), body: content.recruitEmailBody(t) };
    }
    case 'invite': {
      const t = sampleInvite();
      return { from, to: 'd.hall@example.com', subject: content.inviteEmailSubject(t), body: content.inviteEmailBody(t) };
    }
    case 'accept_confirm': {
      const t = sampleAcceptConfirm();
      return { from, to: 'd.hall@example.com', subject: content.acceptConfirmEmailSubject(t), body: content.acceptConfirmEmailBody(t) };
    }
    case 'request_received': {
      const t = sampleRequestReceived();
      return { from, to: adminEmail, subject: content.requestReceivedEmailSubject(t), body: content.requestReceivedEmailBody(t) };
    }
    case 'request_approved': {
      const t = sampleRequestApproved();
      return { from, to: 'a.burn@example.net', subject: content.requestApprovedEmailSubject(t), body: content.requestApprovedEmailBody(t) };
    }
    case 'request_denied': {
      const t = sampleRequestDenied();
      return { from, to: 'a.burn@example.net', subject: content.requestDeniedEmailSubject(t), body: content.requestDeniedEmailBody(t) };
    }
    default:
      return null;
  }
}

export async function adminTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/admin/players/templates')) return;
    if (rejectIfCrossOrigin(req, reply, 'json')) return reply;
    const sid = req.cookies?.[SESSION_COOKIE];
    const sess = readSession(sid);
    if (!sess) return reply.code(401).send({ error: 'unauthorized' });
    (req as AdminReq).adminEmail = sess.email;
  });

  app.post('/admin/players/templates', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const entries: Partial<Record<WritableKey, string>> = {};
    const changed: string[] = [];
    for (const k of WRITABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        const incoming = body[k] ?? '';
        if (incoming !== (settings.get(k) ?? '')) changed.push(k);
        entries[k] = incoming;
      }
    }
    if (Object.keys(entries).length > 0) {
      settings.setMany(entries);
    }
    audit(req.adminEmail!, 'config_change', 'templates', { changed }, req.ip);
    return reply.redirect('/admin/players?tab=emails&saved=1');
  });

  app.get('/admin/players/templates/preview', async (req, reply) => {
    const key = String((req.query as Record<string, string | undefined>)?.key ?? '');
    const out = renderPreview(key);
    if (!out) return reply.code(400).send({ error: 'unknown template key' });
    return out;
  });

  app.post('/admin/players/templates/test-send', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const key = String(body.key ?? '');
    const out = renderPreview(key);
    if (!out) return reply.code(400).send({ error: 'unknown template key' });
    if (!mail.isConfigured()) {
      return reply.code(412).send({ ok: false, error: 'mail not configured' });
    }
    const adminEmail = settings.get('admin_email');
    if (!adminEmail) return reply.code(412).send({ ok: false, error: 'no admin email on record' });
    const r = await mail.send({
      to: adminEmail,
      subject: `[preview] ${out.subject}`,
      text: out.body,
    });
    audit(req.adminEmail!, 'send_test_mail', adminEmail, { template: key, ok: r.ok, error: r.error, provider: r.provider }, req.ip);
    if (!r.ok) return reply.code(502).send({ ok: false, error: r.error, provider: r.provider });
    return { ok: true, provider: r.provider, to: adminEmail };
  });
}
