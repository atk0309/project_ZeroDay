// Recruit landing. Red pill / blue pill. Token-gated entry; bare visits show a
// parked-corporate page (handled by the white-rabbit challenge handler when
// served from example.com).
//
// Routes:
//   GET  /recruit              → step 1: identify yourself (alias + email)
//   POST /recruit              → step 2 dispatcher:
//                                  no pill → render pill-choice page
//                                  pill=red  → create user, send magic-link
//                                  pill=blue → goodbye + log refusal
//   GET  /recruit/blue         → fake friendly goodbye page (logs refusal)
//   GET  /auth                 → consumes ?token= magic link, sets session
//   POST /auth/logout          → clears session

import type { FastifyInstance } from 'fastify';
import {
  PLAYER_COOKIE,
  consumeMagicLinkToken,
  createSession,
  destroySession,
  findOrCreateUser,
  getUserByEmail,
  issueMagicLink,
} from '../lib/playerAuth.js';
import * as mail from '../lib/mail.js';
import * as content from '../lib/content.js';
import { db } from '../db/index.js';

const MAGIC_LINK_TTL = '15 min';

const insertEvent = db.prepare(`INSERT INTO events (kind, user_id, payload) VALUES (?, ?, ?)`);

function setPlayerCookie(reply: import('fastify').FastifyReply, sid: string) {
  reply.setCookie(PLAYER_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function recruitRoutes(app: FastifyInstance) {
  app.get('/recruit', async (_req, reply) => {
    return reply.view('recruit-step1.ejs', { message: null });
  });

  app.post('/recruit', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const alias = (body.alias ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const pill = body.pill;

    if (!alias || alias.length < 3 || alias.length > 20) {
      return reply.view('recruit-step1.ejs', { message: 'alias must be 3–20 chars' });
    }
    if (!email.includes('@')) {
      return reply.view('recruit-step1.ejs', { message: 'valid email required' });
    }

    // First POST: alias + email validated, no pill yet → render pill-choice page.
    if (pill !== 'red' && pill !== 'blue') {
      return reply.view('recruit-decide.ejs', { alias, email });
    }

    if (pill === 'blue') {
      const existing = getUserByEmail(email);
      insertEvent.run('refused', existing?.id ?? null, JSON.stringify({ alias, email }));
      return reply.view('recruit-blue.ejs', { alias });
    }

    // Red pill: create user (or rehydrate), issue magic link.
    const user = findOrCreateUser(email, alias);
    insertEvent.run('signup', user.id, JSON.stringify({ alias }));

    const token = issueMagicLink(user.id, user.verified_at ? 'login' : 'signup');
    const origin = process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com';
    const link = `${origin}/auth?token=${token}`;

    if (mail.isConfigured()) {
      const tokens = { alias, magic_link: link, expires_in: MAGIC_LINK_TTL };
      await mail.send({
        to: email,
        subject: content.recruitEmailSubject(tokens),
        text: content.recruitEmailBody(tokens),
      });
    }

    return reply.view('recruit-step2.ejs', {
      alias,
      email,
      mailConfigured: mail.isConfigured(),
      // In dev (or when mail offline) display the magic link directly so a
      // playtester can still proceed.
      devLink: !mail.isConfigured() ? link : null,
    });
  });

  app.get('/recruit/blue', async (_req, reply) => {
    return reply.view('recruit-blue.ejs', {});
  });

  app.get('/auth', async (req, reply) => {
    const token = (req.query as Record<string, string | undefined>)?.token;
    if (!token) return reply.redirect('/recruit');
    const r = consumeMagicLinkToken(token);
    if (!r) {
      return reply.view('recruit-step1.ejs', { message: 'link expired or already used' });
    }
    const sid = createSession(r.user.id);
    setPlayerCookie(reply, sid);
    insertEvent.run('login', r.user.id, JSON.stringify({ purpose: r.purpose }));
    return reply.redirect('/');
  });

  app.post('/auth/logout', async (req, reply) => {
    destroySession(req.cookies?.[PLAYER_COOKIE]);
    reply.clearCookie(PLAYER_COOKIE, { path: '/' });
    return reply.redirect('/recruit');
  });
}
