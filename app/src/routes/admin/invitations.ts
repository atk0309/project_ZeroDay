// Admin JSON API for invitations + invite_requests, plus the public
// /claim/:token flow for invitees.
//
// Admin endpoints live under /admin/api/* and inherit the JSON-401
// preHandler from routes/admin/dashboard.ts (which gates `/admin/api/`).
// We register a sibling preHandler here that mirrors the same logic so
// mounting order doesn't matter.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as invitations from '../../lib/invitations.js';
import { InvitationError } from '../../lib/invitations.js';
import * as inviteRequests from '../../lib/inviteRequests.js';
import * as mail from '../../lib/mail.js';
import * as content from '../../lib/content.js';
import { audit } from '../../lib/audit.js';
import { db } from '../../db/index.js';
import { SESSION_COOKIE, readSession } from '../../lib/adminAuth.js';
import { rejectIfCrossOrigin } from '../../middleware/adminAuthMiddleware.js';
import { PLAYER_COOKIE, createSession } from '../../lib/playerAuth.js';

interface AdminReq extends FastifyRequest { adminEmail?: string }

const insertEvent = db.prepare(`INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)`);

function publicOrigin(): string {
  return process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com';
}

interface InvitationStats {
  sent: number;
  pending: number;
  accepted: number;
  declined: number;
  expired: number;
  accept_rate: number;
  awaiting_claim: number;
  slots_in_pool: number;
}

function computeStats(rows: invitations.Invitation[]): InvitationStats {
  const sent = rows.length;
  let pending = 0, accepted = 0, declined = 0, expired = 0;
  for (const r of rows) {
    if (r.status === 'pending') pending++;
    else if (r.status === 'accepted') accepted++;
    else if (r.status === 'revoked') declined++;
    else if (r.status === 'expired') expired++;
  }
  const decided = sent - pending;
  const accept_rate = decided > 0 ? Math.round((accepted / decided) * 100) : 0;
  const playerCount = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE verified_at IS NOT NULL`).get() as { n: number }).n;
  const slots_in_pool = playerCount * invitations.getLimit();
  return { sent, pending, accepted, declined, expired, accept_rate, awaiting_claim: pending, slots_in_pool };
}

interface RequestStats {
  pending: number;
  approved: number;
  denied: number;
  approval_rate: number;
  avg_ttd: string;
}

function computeRequestStats(rows: inviteRequests.InviteRequest[]): RequestStats {
  let pending = 0, approved = 0, denied = 0;
  let totalDecidedMs = 0, decidedCount = 0;
  for (const r of rows) {
    if (r.status === 'pending') pending++;
    else if (r.status === 'approved') approved++;
    else if (r.status === 'denied') denied++;
    if (r.decided_at && r.created_at) {
      const ms = new Date(r.decided_at).getTime() - new Date(r.created_at).getTime();
      if (ms >= 0) { totalDecidedMs += ms; decidedCount++; }
    }
  }
  const decided = approved + denied;
  const approval_rate = decided > 0 ? Math.round((approved / decided) * 100) : 0;
  let avg_ttd = '—';
  if (decidedCount > 0) {
    const avgMs = totalDecidedMs / decidedCount;
    const hours = avgMs / 3_600_000;
    avg_ttd = hours < 1 ? `${Math.round(hours * 60)}m` : `${Math.round(hours)}h`;
  }
  return { pending, approved, denied, approval_rate, avg_ttd };
}

async function sendInviteMail(
  inviterAlias: string,
  invitation: invitations.Invitation
): Promise<{ ok: boolean; error?: string }> {
  if (!mail.isConfigured()) return { ok: false, error: 'mail not configured' };
  const claimLink = `${publicOrigin()}/claim/${invitation.token}`;
  const tokens: content.InviteTokens = {
    inviter_alias: inviterAlias,
    claim_link: claimLink,
    expires_in: invitations.expiresInLabel(),
    note: invitation.note ?? '',
    note_block: content.inviteNoteBlock(invitation.note),
  };
  const r = await mail.send({
    to: invitation.invitee_email,
    subject: content.inviteEmailSubject(tokens),
    text: content.inviteEmailBody(tokens),
  });
  return { ok: r.ok, error: r.error };
}

export async function inviteRoutes(app: FastifyInstance) {
  // ── Admin JSON API gate ────────────────────────────────────────────
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/admin/api/invit')
        && !req.url.startsWith('/admin/api/invite-request')) return;
    if (rejectIfCrossOrigin(req, reply, 'json')) return reply;
    const sid = req.cookies?.[SESSION_COOKIE];
    const sess = readSession(sid);
    if (!sess) return reply.code(401).send({ error: 'unauthorized' });
    (req as AdminReq).adminEmail = sess.email;
  });

  app.get('/admin/api/invitations', async () => {
    const rows = invitations.listAll();
    const stats = computeStats(rows);
    return { invitations: rows, stats };
  });

  app.post('/admin/api/invitations', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // inviter_id may be null (custom alias path) or a positive integer.
    const rawInviterId = body.inviter_id;
    let inviterId: number | null;
    if (rawInviterId === null || rawInviterId === '' || rawInviterId === undefined) {
      inviterId = null;
    } else {
      const n = Number.parseInt(String(rawInviterId), 10);
      if (!Number.isFinite(n) || n <= 0) return reply.code(400).send({ error: 'inviter_id invalid' });
      inviterId = n;
    }
    const inviteeEmail = String(body.invitee_email ?? '').trim().toLowerCase();
    const note = body.note != null ? String(body.note).trim() : null;
    const aliasOverride = body.inviter_alias_override != null
      ? String(body.inviter_alias_override).trim()
      : null;
    if (!inviteeEmail.includes('@')) return reply.code(400).send({ error: 'invalid email' });

    let invite;
    try {
      invite = invitations.createInvitation({
        inviterId,
        inviteeEmail,
        note,
        source: 'admin_override',
        bypassQuota: true,
        inviterAliasOverride: aliasOverride,
      });
    } catch (e) {
      if (e instanceof InvitationError) return reply.code(400).send({ error: e.code });
      throw e;
    }

    insertEvent.run(
      'invite_sent',
      inviterId,
      JSON.stringify({
        invitation_id: invite.id,
        invitee_email: invite.invitee_email,
        source: 'admin_override',
        ...(invite.inviter_alias_override ? { inviter_alias_override: invite.inviter_alias_override } : {}),
      })
    );

    const displayAlias = invitations.inviterDisplayAlias(invite, 'admin');
    const m = await sendInviteMail(displayAlias, invite);
    audit(req.adminEmail!, 'invite_send', String(invite.id), {
      inviter_id: inviterId,
      invitee_email: invite.invitee_email,
      source: 'admin_override',
      inviter_alias_override: invite.inviter_alias_override,
      mail_ok: m.ok,
    }, req.ip);

    return { ok: true, invitation: invite, mail: m };
  });

  app.post('/admin/api/invitations/:id/revoke', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const inv = invitations.findById(id);
    if (!inv) return reply.code(404).send({ error: 'unknown invitation' });
    const ok = invitations.revokeInvitation(id, req.adminEmail!);
    if (!ok) return reply.code(409).send({ error: 'not pending' });
    audit(req.adminEmail!, 'invite_revoke', String(id), {
      inviter_id: inv.inviter_id, invitee_email: inv.invitee_email,
    }, req.ip);
    return { ok: true };
  });

  app.get('/admin/api/invite-requests', async () => {
    const rows = inviteRequests.listAll();
    const stats = computeRequestStats(rows);
    return { requests: rows, stats };
  });

  app.post('/admin/api/invite-requests/:id/approve', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const note = body.note != null ? String(body.note).trim() : null;
    const inviteeEmail = body.invitee_email != null ? String(body.invitee_email).trim().toLowerCase() : null;

    let result;
    try {
      result = inviteRequests.approveRequest({ id, adminEmail: req.adminEmail!, note, inviteeEmail });
    } catch (e) {
      if (e instanceof InvitationError) return reply.code(400).send({ error: e.code });
      throw e;
    }
    if (!result.ok) return reply.code(409).send({ error: result.reason });

    const reqRow = inviteRequests.findById(id)!;
    insertEvent.run(
      'invite_sent',
      reqRow.requester_id,
      JSON.stringify({ invitation_id: result.invitation.id, invitee_email: result.invitation.invitee_email, source: 'admin_grant' })
    );

    const requester = db.prepare(`SELECT alias, email FROM users WHERE id = ?`).get(reqRow.requester_id) as { alias: string; email: string } | undefined;
    const m = await sendInviteMail(requester?.alias ?? 'operator', result.invitation);

    // Notify the requester that their ask landed — but only if the invite
    // to the invitee actually went out. Otherwise we'd be telling the
    // requester "invite dispatched" while no invite reached the target.
    // The approval itself is already persisted; an admin tailing logs can
    // re-trigger the send manually.
    if (m.ok && requester?.email && mail.isConfigured()) {
      const tokens: content.RequestApprovedTokens = {
        requester_alias: requester.alias,
        invitee_email: result.invitation.invitee_email,
        note: note ?? '',
        note_block: content.adminNoteBlock(note),
        lobby_link: `${publicOrigin()}/`,
      };
      const r = await mail.send({
        to: requester.email,
        subject: content.requestApprovedEmailSubject(tokens),
        text: content.requestApprovedEmailBody(tokens),
      });
      if (!r.ok) req.log.warn({ error: r.error, request_id: id }, 'request-approved mail send failed');
    } else if (!m.ok) {
      req.log.warn({ error: m.error, request_id: id, invitation_id: result.invitation.id },
        'invite send failed; skipping requester confirmation');
    }

    audit(req.adminEmail!, 'request_approve', String(id), {
      requester_id: reqRow.requester_id,
      granted_invitation_id: result.invitation.id,
      note,
    }, req.ip);

    return { ok: true, invitation: result.invitation, mail: m };
  });

  app.post('/admin/api/invite-requests/:id/deny', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const note = body.note != null ? String(body.note).trim() : '';
    if (!note) return reply.code(400).send({ error: 'note_required' });

    const result = inviteRequests.denyRequest({ id, adminEmail: req.adminEmail!, note });
    if (!result.ok) return reply.code(409).send({ error: result.reason });

    const reqRow = inviteRequests.findById(id)!;
    const requester = db.prepare(`SELECT alias, email FROM users WHERE id = ?`).get(reqRow.requester_id) as { alias: string; email: string } | undefined;

    if (requester?.email && mail.isConfigured()) {
      const tokens: content.RequestDeniedTokens = {
        requester_alias: requester.alias,
        invitee_email: reqRow.invitee_email ?? '—',
        note,
        lobby_link: `${publicOrigin()}/`,
      };
      const r = await mail.send({
        to: requester.email,
        subject: content.requestDeniedEmailSubject(tokens),
        text: content.requestDeniedEmailBody(tokens),
      });
      if (!r.ok) req.log.warn({ error: r.error, request_id: id }, 'request-denied mail send failed');
    }

    audit(req.adminEmail!, 'request_deny', String(id), {
      requester_id: reqRow.requester_id, note,
    }, req.ip);
    return { ok: true };
  });

  // ── Public claim flow ──────────────────────────────────────────────

  app.get('/claim/:token', async (req, reply: FastifyReply) => {
    const token = (req.params as Record<string, string>).token;
    invitations.sweepExpired();
    const inv = invitations.findByToken(token);
    if (!inv) return reply.view('claim-dead.ejs', { reason: 'unknown token' });
    if (inv.status === 'revoked') return reply.view('claim-dead.ejs', { reason: 'invitation revoked' });
    if (inv.status === 'expired') return reply.view('claim-dead.ejs', { reason: 'invitation expired' });
    if (inv.status === 'accepted') return reply.view('claim-dead.ejs', { reason: 'invitation already claimed' });

    return reply.view('claim.ejs', {
      token,
      invitee_email: inv.invitee_email,
      inviter_alias: invitations.inviterDisplayAlias(inv),
      note: inv.note,
      message: null,
    });
  });

  app.post('/claim/:token', async (req, reply: FastifyReply) => {
    const token = (req.params as Record<string, string>).token;
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const alias = (body.alias ?? '').trim();

    const inv = invitations.findByToken(token);

    function rerender(message: string) {
      return reply.view('claim.ejs', {
        token,
        invitee_email: inv?.invitee_email ?? '',
        inviter_alias: inv ? invitations.inviterDisplayAlias(inv) : 'an operator',
        note: inv?.note ?? null,
        message,
      });
    }

    if (alias.length < 3 || alias.length > 20) {
      return rerender('alias must be 3–20 chars');
    }

    const r = invitations.claimInvitation({ token, alias });
    if (!r.ok) {
      if (r.reason === 'alias_taken') return rerender('alias already taken — pick another');
      return reply.view('claim-dead.ejs', { reason: r.reason.replace('_', ' ') });
    }

    // Mark verified, mint a session, set the cookie. Mirrors recruit's
    // post-magic-link flow.
    db.prepare(`UPDATE users SET verified_at = datetime('now') WHERE id = ? AND verified_at IS NULL`).run(r.user.id);
    const sid = createSession(r.user.id);
    reply.setCookie(PLAYER_COOKIE, sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
    });
    insertEvent.run('signup', r.user.id, JSON.stringify({ alias: r.user.alias, via: 'invite' }));
    insertEvent.run('invite_claimed', r.user.id, JSON.stringify({
      invitation_id: r.invitation.id, inviter_id: r.invitation.inviter_id,
    }));

    // Welcome the new operator with the accept-confirm template. Best-effort
    // — claim has already succeeded, so a mail failure must not block the
    // session redirect.
    if (mail.isConfigured()) {
      const slotRow = db.prepare(`
        SELECT COUNT(*) AS n FROM users
        WHERE verified_at IS NOT NULL AND id <= ?
      `).get(r.user.id) as { n: number } | undefined;
      const slotNumber = String(slotRow?.n ?? 0).padStart(3, '0');
      const tokens: content.AcceptConfirmTokens = {
        alias: r.user.alias,
        slot_number: slotNumber,
        inviter_alias: invitations.inviterDisplayAlias(r.invitation),
        lobby_link: `${publicOrigin()}/`,
      };
      const sendResult = await mail.send({
        to: r.user.email,
        subject: content.acceptConfirmEmailSubject(tokens),
        text: content.acceptConfirmEmailBody(tokens),
      });
      if (!sendResult.ok) {
        req.log.warn({ error: sendResult.error, user_id: r.user.id }, 'accept-confirm mail send failed');
      }
    }

    return reply.redirect('/');
  });
}
