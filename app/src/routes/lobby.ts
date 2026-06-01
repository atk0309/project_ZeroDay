// Operator-side lobby endpoints. All require an authenticated player session
// (PLAYER_COOKIE). Form-encoded POSTs that 303-redirect back to / with a
// ?msg=… query — the lobby controller in routes/hub.ts parses that into a
// flash banner.

import type { FastifyInstance, FastifyReply } from 'fastify';
import * as invitations from '../lib/invitations.js';
import { InvitationError } from '../lib/invitations.js';
import * as inviteRequests from '../lib/inviteRequests.js';
import { InviteRequestError } from '../lib/inviteRequests.js';
import * as mail from '../lib/mail.js';
import * as content from '../lib/content.js';
import * as settings from '../lib/settings.js';
import { db } from '../db/index.js';
import { enforcePlayerState, loadPlayer, type PlayerRequest } from '../middleware/playerAuthMiddleware.js';

const insertEvent = db.prepare(`INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)`);

function publicOrigin(): string {
  return process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com';
}

function back(reply: FastifyReply, msg: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ msg, ...(extra ?? {}) });
  return reply.redirect(`/?${params.toString()}`);
}

export async function lobbyRoutes(app: FastifyInstance) {
  // Issue an invitation. Operator session required.
  app.post('/lobby/invite', async (req: PlayerRequest, reply) => {
    await loadPlayer(req);
    if (!req.player) return reply.redirect('/recruit');
    if (await enforcePlayerState(req, reply)) return;

    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const email = (body.email ?? '').trim().toLowerCase();
    const note = (body.note ?? '').trim();

    if (!email.includes('@')) return back(reply, 'err_invalid_email');
    if (note.length > 240) return back(reply, 'err_note_too_long');

    let invite;
    try {
      invite = invitations.createInvitation({
        inviterId: req.player.id,
        inviteeEmail: email,
        note: note || null,
      });
    } catch (e) {
      if (e instanceof InvitationError) {
        return back(reply, `err_${e.code}`);
      }
      throw e;
    }

    insertEvent.run(
      'invite_sent',
      req.player.id,
      JSON.stringify({ invitation_id: invite.id, invitee_email: invite.invitee_email })
    );

    const claimLink = `${publicOrigin()}/claim/${invite.token}`;
    let msg = 'invited';
    let extra: Record<string, string> | undefined;

    if (mail.isConfigured()) {
      const tokens: content.InviteTokens = {
        inviter_alias: req.player.alias,
        claim_link: claimLink,
        expires_in: invitations.expiresInLabel(),
        note,
        note_block: content.inviteNoteBlock(note),
      };
      const r = await mail.send({
        to: invite.invitee_email,
        subject: content.inviteEmailSubject(tokens),
        text: content.inviteEmailBody(tokens),
      });
      // Slot is already consumed (the row exists). If mail failed, surface the
      // claim link so the operator can deliver it manually before the TTL.
      if (!r.ok) {
        req.log.warn({ error: r.error, invitation_id: invite.id }, 'invite mail send failed');
        msg = 'err_mail_failed';
        extra = { dev_link: claimLink };
      }
    } else {
      // Mail offline → surface link inline so the operator can hand-deliver.
      extra = { dev_link: claimLink };
    }

    return back(reply, msg, extra);
  });

  // Revoke a pending invitation. Owner-only.
  app.post('/lobby/invite/:id/revoke', async (req: PlayerRequest, reply) => {
    await loadPlayer(req);
    if (!req.player) return reply.redirect('/recruit');
    if (await enforcePlayerState(req, reply)) return;

    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });

    const inv = invitations.findById(id);
    if (!inv) return reply.code(404).send({ error: 'unknown invitation' });
    if (inv.inviter_id !== req.player.id) return reply.code(403).send({ error: 'forbidden' });

    invitations.revokeInvitation(id, 'operator');
    return back(reply, 'revoked');
  });

  // Submit an extra-slot request to the admin.
  app.post('/lobby/invite-request', async (req: PlayerRequest, reply) => {
    await loadPlayer(req);
    if (!req.player) return reply.redirect('/recruit');
    if (await enforcePlayerState(req, reply)) return;

    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const reason = (body.reason ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase() || null;
    if (!reason) return back(reply, 'err_invalid_reason');

    let request;
    try {
      request = inviteRequests.createRequest({
        requesterId: req.player.id,
        inviteeEmail: email,
        reason,
      });
    } catch (e) {
      if (e instanceof InviteRequestError) {
        return back(reply, `err_${e.code}`);
      }
      throw e;
    }

    insertEvent.run(
      'invite_request_sent',
      req.player.id,
      JSON.stringify({ request_id: request.id, invitee_email: request.invitee_email })
    );

    // Notify the admin so the request doesn't sit unseen until they next
    // open the dashboard. Best-effort — request is already persisted.
    const adminEmail = settings.get('admin_email');
    if (adminEmail && mail.isConfigured()) {
      const tokens: content.RequestReceivedTokens = {
        requester_alias: req.player.alias,
        requester_email: req.player.email,
        invitee_email: request.invitee_email ?? '—',
        reason: request.reason,
        admin_link: `${publicOrigin()}/admin/players?tab=requests`,
      };
      const r = await mail.send({
        to: adminEmail,
        subject: content.requestReceivedEmailSubject(tokens),
        text: content.requestReceivedEmailBody(tokens),
      });
      if (!r.ok) {
        req.log.warn({ error: r.error, request_id: request.id }, 'request-received mail send failed');
      }
    }
    return back(reply, 'requested');
  });
}
