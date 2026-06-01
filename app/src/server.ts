// Server bootstrap. Single Fastify process, host-based routing for the
// challenge subdomains, all admin/player API on the canonical hub host.

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import fastifyRateLimit from '@fastify/rate-limit';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { adminLoginRoutes } from './routes/admin/login.js';
import { adminSetupRoutes } from './routes/admin/setup.js';
import { adminDashboardRoutes } from './routes/admin/dashboard.js';
import { adminTemplatesRoutes } from './routes/admin/templates.js';
import { inviteRoutes } from './routes/admin/invitations.js';
import { recruitRoutes } from './routes/recruit.js';
import { hubRoutes } from './routes/hub.js';
import { lobbyRoutes } from './routes/lobby.js';
import { submitRoutes } from './routes/submit.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { strikeNoticeRoutes } from './routes/strikeNotice.js';
import { privacyRoutes } from './routes/privacy.js';
import { startDripCron } from './cron/dripHints.js';
import { challenges } from './challenges/registry.js';
import { handlerFor } from './challenges/handlers/index.js';
import { generateFlag } from './lib/flags.js';
import { getProgress } from './lib/progress.js';
import { phaseState } from './lib/phase.js';
import * as mail from './lib/mail.js';
import * as content from './lib/content.js';
import { maybeResetAdmin } from './lib/adminReset.js';
import { dbPath, dbPathSource } from './db/index.js';
import { enforcePlayerState, loadPlayer, type PlayerRequest } from './middleware/playerAuthMiddleware.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

// Fail closed in production when the cookie-signing or flag secrets are missing
// or still a recognizable placeholder. Once the source is public these defaults
// are known to everyone: a default SESSION_SECRET lets an attacker forge the
// signed `admin_bootstrap_ready` cookie and seize the admin seat on a fresh
// deploy (CLAUDE.md invariant #6), and a default FLAG_SECRET weakens the
// per-player flag derivation the whole anti-cheat story rests on. ops/docker-
// compose.yml already enforces this via `${VAR:?must be set}`; this extends the
// same contract to every production boot (Railway, bare `node`). No-op outside
// production, so tests and `npm run dev` are unaffected.
function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const weak = (v: string | undefined) => !v || /change-me/i.test(v);
  const missing: string[] = [];
  if (weak(process.env.SESSION_SECRET)) missing.push('SESSION_SECRET');
  if (weak(process.env.FLAG_SECRET)) missing.push('FLAG_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `Refusing to boot: ${missing.join(' and ')} must be set to a strong, non-default ` +
        'value in production (generate with `openssl rand -hex 32`). See docs/operator.md.',
    );
  }
}

export async function build() {
  assertProductionSecrets();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
  });

  await app.register(fastifyCookie, {
    secret: process.env.SESSION_SECRET ?? 'dev-cookie-secret-change-me',
  });
  await app.register(fastifyFormbody);
  await app.register(fastifyView, {
    engine: { ejs },
    root: join(projectRoot, 'web', 'views'),
    propertyName: 'view',
    includeViewExtension: true,
  });
  await app.register(fastifyStatic, {
    root: join(projectRoot, 'web', 'static'),
    prefix: '/static/',
    decorateReply: false,
  });
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    skipOnError: true,
  });

  // Per-route stricter limit on /api/submit.
  app.addHook('onRoute', (route) => {
    if (route.path === '/api/submit') {
      route.config = { ...(route.config ?? {}), rateLimit: { max: 5, timeWindow: '1 minute' } };
    }
  });

  // Cookie-consent bootstrap injection. Splices a tiny <link>+<script> block
  // before </body> on every public HTML response so the banner appears
  // everywhere without per-view edits. The actual UI lives in
  // /static/consent.{js,css}; this hook only seeds window.__zdConsent with
  // the runtime Clarity project ID (empty string disables that script).
  // Skipped on /admin/*, /api/*, /static/*, /auth/* — see plan in
  // .claude/plans/hey-can-you-check-snoopy-locket.md.
  app.addHook('onSend', async (req, reply, payload) => {
    const url = req.url || '';
    if (
      url.startsWith('/admin') || url.startsWith('/api') ||
      url.startsWith('/static') || url.startsWith('/auth')
    ) return payload;
    const ctHeader = reply.getHeader('content-type');
    const ct = Array.isArray(ctHeader) ? ctHeader[0] : ctHeader;
    if (typeof ct !== 'string' || !ct.toLowerCase().startsWith('text/html')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    const clarityId = (process.env.CLARITY_PROJECT_ID ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    const snippet =
      '<link rel="stylesheet" href="/static/consent.css">' +
      `<script>window.__zdConsent={clarityId:"${clarityId}"};</script>` +
      '<script src="/static/consent.js" defer></script>';
    const idx = body.search(/<\/body\s*>/i);
    const out = idx === -1 ? body + snippet : body.slice(0, idx) + snippet + body.slice(idx);
    if (reply.getHeader('content-length') != null) {
      reply.header('content-length', Buffer.byteLength(out));
    }
    return out;
  });

  app.log.info({ dbPath, source: dbPathSource }, 'db: resolved sqlite path');

  // Boot-time admin reset. RESET_ADMIN=true + a fresh (strictly-greater)
  // RESET_ADMIN_SAFETY clears admin_password_hash so the 5-click easter egg
  // arms again on the next /admin/login visit. Consume-once via the persisted
  // nonce — leaving RESET_ADMIN=true across redeploys is a no-op.
  const reset = maybeResetAdmin();
  if (reset.reset) {
    app.log.warn({ nonce: reset.nonce, previousNonce: reset.previousNonce },
      'admin: password cleared via RESET_ADMIN — easter egg armed for next /admin/login visitor');
  } else if (reset.reason !== 'disabled') {
    app.log.warn({ reason: reset.reason, nonce: reset.nonce, previousNonce: reset.previousNonce },
      'admin: RESET_ADMIN set but reset skipped');
  }

  // First-boot mail seeding from MAIL_* env vars. No-op once admin has saved
  // mail config in the console (DB row wins after that).
  const seed = mail.seedFromEnv();
  if (seed.seeded) {
    app.log.info({ provider: seed.seeded }, 'mail: seeded app_settings from env');
  } else if (seed.reason && seed.reason !== 'env-missing') {
    app.log.warn({ reason: seed.reason }, 'mail: env-var seed skipped');
  }

  // First-boot recruit-content seeding. Writes default email body + lobby
  // flavor only when the keys are unset; admin edits are preserved.
  const contentSeed = content.seedDefaults();
  if (contentSeed.seeded.length) {
    app.log.info({ keys: contentSeed.seeded }, 'content: seeded recruit defaults');
  }

  // Host-based dispatch for the challenge subdomains. Each non-hub host maps to
  // the puzzle whose meta.subdomain matches it. Player must be authed and at
  // the matching ordinal; otherwise locked.
  //
  // The canonical hub host is also a challenge subdomain (no-spoon, #2),
  // so we can't use the host filter alone to decide bypass. The hub root
  // (`/`) on the hub host must always reach hubRoutes, otherwise pre-stage-2
  // players hit the locked screen on every login.
  const HUB_HOST = (process.env.HUB_HOST
    ?? (process.env.PUBLIC_ORIGIN ?? 'https://hack.example.com').replace(/^https?:\/\//, ''))
    .split('/')[0].split(':')[0].toLowerCase();

  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
    const url = req.url;
    // Pathname only — exact-match allowlist entries below must compare against
    // the path, not the raw URL, so that e.g. `/privacy?utm_source=…` still
    // routes to the privacy handler instead of falling into challenge dispatch
    // on the hub host (which doubles as challenge #2's subdomain).
    const path = url.split('?', 1)[0];
    // Hub-only paths: regardless of host, these always route through the
    // canonical handlers. `/` is host-dependent — see the special-case below.
    if (url.startsWith('/static/') || url.startsWith('/api/') || url.startsWith('/admin') || url.startsWith('/c/') || url.startsWith('/auth') || url.startsWith('/recruit') || url.startsWith('/lobby/') || url.startsWith('/claim/') || url.startsWith('/strike-notice') || path === '/frozen' || path === '/board' || path === '/manual' || path === '/privacy') {
      // hub routes — let normal handlers run
      return;
    }
    // Hub root must always reach hubRoutes on the canonical hub host. On
    // subdomain hosts (oracle, gibson, zero, etc.) `/` is the challenge
    // landing — let the dispatcher route it.
    if (url === '/' && host === HUB_HOST) {
      return;
    }
    // For known subdomains, look up the matching challenge and dispatch.
    const matches = challenges.filter((c) => c.subdomain === host);
    if (matches.length === 0) return; // unknown host → fall through
    const playerReq = req as PlayerRequest;
    await loadPlayer(playerReq);

    // Public face: when an unauthenticated visitor hits example.com, we still
    // serve the corporate front (challenge 1's handler renders that landing).
    // For authenticated hosts that aren't the player's current ordinal, lock.
    const ps = phaseState();
    if (ps.phase === 'uninitialized') {
      reply.view('uninitialized.ejs', {});
      return reply;
    }
    if (!playerReq.player) {
      // Unauthed: only allow if this is the public face (challenge 1).
      const candidate = matches.find((c) => c.ordinal === 1) ?? matches[0];
      const handler = handlerFor(candidate);
      // Use a bogus zero user — the puzzle pages key off the user salt for the
      // flag, but the public landing's flag isn't meant to be obtained here:
      // it's gated by the /matrix path which lives on the same host.
      const zeroUser = { id: 0, email: '', alias: 'guest', flag_salt: 'public-face', created_at: '', verified_at: null, last_seen_at: null };
      await handler.page(req, reply, { user: zeroUser as never, flag: generateFlag(zeroUser as never, candidate.id) });
      return reply;
    }
    if (ps.phase !== 'live') {
      reply.redirect('/');
      return reply;
    }

    if (await enforcePlayerState(playerReq, reply)) return reply;

    const progress = getProgress(playerReq.player.id);
    const cur = progress?.current_ordinal ?? 1;
    const open = matches.find((c) => c.ordinal === cur);
    if (!open) {
      reply.code(403).view('locked.ejs', { reason: 'no current trial on this host', currentOrdinal: cur });
      return reply;
    }
    const handler = handlerFor(open);
    const flag = generateFlag(playerReq.player, open.id);
    await handler.page(req, reply, { user: playerReq.player, flag });
    return reply;
  });

  await app.register(adminLoginRoutes);
  await app.register(adminSetupRoutes);
  await app.register(adminTemplatesRoutes);
  await app.register(adminDashboardRoutes);
  await app.register(inviteRoutes);
  await app.register(recruitRoutes);
  await app.register(hubRoutes);
  await app.register(lobbyRoutes);
  await app.register(submitRoutes);
  await app.register(leaderboardRoutes);
  await app.register(strikeNoticeRoutes);
  await app.register(privacyRoutes);

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await build();
  startDripCron();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  app.log.info(`zeroday listening on ${host}:${port}`);
}
