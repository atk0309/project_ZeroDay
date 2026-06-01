// /admin — operator console.
//
// Pass 2 layout:
//   GET /admin                — dense or narrative HTML render (cookie-gated)
//   POST /admin/variation     — flip variation cookie, redirect back
//   POST /admin/skip          — form-POST fallback, advances player past stage
//   POST /admin/hint          — form-POST fallback, dispatches a hint
//   GET /admin/api/player/:id      — JSON for the slide-out drawer
//   POST /admin/api/player/:id/hint  — JSON skip/hint endpoints used by drawer JS
//   POST /admin/api/player/:id/skip
//   GET /admin/api/events?since=  — long-poll for live feed (5s client interval)

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../db/index.js';
import { challenges, totalChallenges } from '../../challenges/registry.js';
import { adminSkip } from '../../lib/progress.js';
import { audit } from '../../lib/audit.js';
import { phaseState } from '../../lib/phase.js';
import * as mail from '../../lib/mail.js';
import * as invitations from '../../lib/invitations.js';
import * as inviteRequests from '../../lib/inviteRequests.js';
import * as settings from '../../lib/settings.js';
import { handlerFor } from '../../challenges/handlers/index.js';
import { SESSION_COOKIE, readSession } from '../../lib/adminAuth.js';
import { rejectIfCrossOrigin } from '../../middleware/adminAuthMiddleware.js';
import { HINT_COSTS, HINT_LABELS, HINT_LEVELS, MAX_HINT_LEVEL, isHintLevel, type HintLevel } from '../../lib/hints.js';
import { adminClearStrikes, adminUnfreeze, listStrikesForSupplier } from '../../lib/cheat.js';

interface AdminReq extends FastifyRequest { adminEmail?: string; }

const VARIATION_COOKIE = 'admin_variation';
type Variation = 'dense' | 'narrative';

function readVariation(req: FastifyRequest): Variation {
  return req.cookies?.[VARIATION_COOKIE] === 'narrative' ? 'narrative' : 'dense';
}

const playerGrid = db.prepare(`
  SELECT
    u.id, u.email, u.alias, u.verified_at, u.last_seen_at,
    p.current_ordinal, p.last_advance_at, p.admin_skips, p.completed_at,
    (SELECT COUNT(*) FROM solves s WHERE s.user_id = u.id AND s.flag_source='player') AS solves,
    (SELECT COUNT(*) FROM hints_sent h WHERE h.user_id = u.id) AS hints,
    (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
  FROM users u
  LEFT JOIN user_progress p ON p.user_id = u.id
  ORDER BY p.current_ordinal DESC, p.last_advance_at ASC
`);

const recentEvents = db.prepare(`
  SELECT e.id, e.kind, e.payload, e.created_at, u.alias
  FROM events e LEFT JOIN users u ON u.id = e.user_id
  ORDER BY e.id DESC LIMIT 100
`);

const eventsSince = db.prepare(`
  SELECT e.id, e.kind, e.payload, e.created_at, u.alias
  FROM events e LEFT JOIN users u ON u.id = e.user_id
  WHERE e.id > ?
  ORDER BY e.id ASC LIMIT 200
`);

const recentAudit = db.prepare(`
  SELECT id, email, action, target, payload, ip, created_at
  FROM admin_audit_log ORDER BY id DESC LIMIT 100
`);

const stuckCandidates = db.prepare(`
  SELECT u.id, u.alias, u.email, p.current_ordinal,
         (julianday('now') - julianday(p.last_advance_at)) * 24 AS hours_stuck,
         (SELECT MAX(level) FROM hints_sent h WHERE h.user_id = u.id AND h.challenge_id = (SELECT id FROM challenges WHERE ordinal = p.current_ordinal)) AS last_hint,
         (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.challenge_id = (SELECT id FROM challenges WHERE ordinal = p.current_ordinal)) AS attempts_on_stage
  FROM users u JOIN user_progress p ON p.user_id = u.id
  WHERE u.verified_at IS NOT NULL AND p.completed_at IS NULL
    AND (julianday('now') - julianday(p.last_advance_at)) * 24 > 20
  ORDER BY hours_stuck DESC
`);

const cohortFunnel = db.prepare(`
  SELECT current_ordinal AS ordinal, COUNT(*) AS n
  FROM user_progress
  WHERE completed_at IS NULL
  GROUP BY current_ordinal
`);

const submitsPerHour = db.prepare(`
  SELECT strftime('%Y-%m-%dT%H', created_at) AS bucket, COUNT(*) AS n
  FROM attempts
  WHERE created_at > datetime('now', '-12 hours')
  GROUP BY bucket
  ORDER BY bucket ASC
`);

const activePerHour = db.prepare(`
  SELECT strftime('%Y-%m-%dT%H', last_seen_at) AS bucket, COUNT(*) AS n
  FROM users
  WHERE last_seen_at IS NOT NULL AND last_seen_at > datetime('now', '-12 hours')
  GROUP BY bucket
  ORDER BY bucket ASC
`);

const playerById = db.prepare(`
  SELECT u.id, u.email, u.alias, u.flag_salt, u.verified_at, u.last_seen_at, u.created_at,
         u.frozen_at, u.frozen_reason, u.cheat_strikes,
         p.current_ordinal, p.last_advance_at, p.admin_skips, p.completed_at,
         (SELECT COUNT(*) FROM solves s WHERE s.user_id = u.id AND s.flag_source='player') AS solves,
         (SELECT COUNT(*) FROM solves s WHERE s.user_id = u.id AND s.flag_source='admin_skip') AS skip_solves,
         (SELECT COUNT(*) FROM hints_sent h WHERE h.user_id = u.id) AS hints_used,
         (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
  FROM users u
  LEFT JOIN user_progress p ON p.user_id = u.id
  WHERE u.id = ?
`);

const playerAttempts = db.prepare(`
  SELECT a.challenge_id, c.ordinal, c.title, a.submitted, a.correct, a.created_at
  FROM attempts a
  LEFT JOIN challenges c ON c.id = a.challenge_id
  WHERE a.user_id = ?
  ORDER BY a.id DESC
  LIMIT 10
`);

const insertHint = db.prepare(`
  INSERT INTO hints_sent (user_id, challenge_id, level, body) VALUES (?, ?, ?, ?)
`);

const MAX_HINT_BODY = 2000;

// Bucket aggregator: turn the GROUP BY rows into an exactly-12-element array
// of counts ordered chronologically (oldest first), with zero-fill.
function buildHourlyBuckets(rows: { bucket: string; n: number }[]): number[] {
  const map = new Map(rows.map((r) => [r.bucket, r.n]));
  const out: number[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const key = d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    out.push(map.get(key) ?? 0);
  }
  return out;
}

function filterPlayers(rows: ReturnType<typeof playerGrid.all>, q: string, stuckOnly: boolean) {
  const needle = q.trim().toLowerCase();
  return (rows as Record<string, unknown>[]).filter((p) => {
    if (needle) {
      const alias = String(p.alias ?? '').toLowerCase();
      const email = String(p.email ?? '').toLowerCase();
      if (!alias.includes(needle) && !email.includes(needle)) return false;
    }
    if (stuckOnly) {
      if (!p.last_advance_at) return false;
      const hours = (Date.now() - new Date(p.last_advance_at as string).getTime()) / 3_600_000;
      if (hours <= 20) return false;
    }
    return true;
  });
}

// Shared template locals for any admin view that includes _drawer.ejs or
// otherwise references the hint config. Spread into reply.view(...).
const hintCtx = {
  hintCosts: HINT_COSTS,
  hintLabels: HINT_LABELS,
  hintLevels: HINT_LEVELS,
  maxHintLevel: MAX_HINT_LEVEL,
};

async function dispatchHint(
  adminEmail: string,
  ip: string,
  userId: number,
  challengeId: string,
  level: HintLevel,
  bodyOverride: string | null,
) {
  const meta = challenges.find((c) => c.id === challengeId);
  if (!meta) return { ok: false as const, error: 'unknown challenge' };
  const userRow = db.prepare(`SELECT email, alias FROM users WHERE id = ?`).get(userId) as { email: string; alias: string } | undefined;
  if (!userRow) return { ok: false as const, error: 'unknown user' };

  const handler = handlerFor(meta);
  const canned = handler.hints[`hint${level}` as `hint${HintLevel}`];
  const trimmed = bodyOverride?.trim() ?? '';
  const customized = trimmed.length > 0;
  const finalBody = customized ? trimmed : canned;

  let mailOk = false;
  let mailErr: string | undefined;
  if (mail.isConfigured()) {
    const r = await mail.send({
      to: userRow.email,
      subject: `[ZeroDay] transmission — ${meta.title}`,
      text: `${userRow.alias},\n\nthe operators noticed you've been stuck on "${meta.title}".\n\n  ${finalBody}\n\n— operators`,
    });
    mailOk = r.ok;
    mailErr = r.error;
  }
  insertHint.run(userId, challengeId, level, finalBody);
  audit(
    adminEmail,
    'send_hint',
    String(userId),
    { challenge_id: challengeId, level, mailOk, mailErr, customized, bodyLen: finalBody.length },
    ip,
  );
  return { ok: true as const, mailOk, mailErr };
}

export async function adminDashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/admin')) return;
    if (req.url.startsWith('/admin/login')) return;
    if (req.url.startsWith('/admin/setup')) return;
    if (req.url.startsWith('/admin/account')) return; // gated by setup plugin
    // /admin/api/* returns JSON 401 instead of redirecting
    if (req.url.startsWith('/admin/api/')) {
      if (rejectIfCrossOrigin(req, reply, 'json')) return reply;
      const sid = req.cookies?.[SESSION_COOKIE];
      const sess = readSession(sid);
      if (!sess) return reply.code(401).send({ error: 'unauthorized' });
      (req as AdminReq).adminEmail = sess.email;
      return;
    }
    if (rejectIfCrossOrigin(req, reply, 'html')) return reply;
    const sid = req.cookies?.[SESSION_COOKIE];
    const sess = readSession(sid);
    if (!sess) return reply.redirect('/admin/login');
    (req as AdminReq).adminEmail = sess.email;
  });

  app.get('/admin', async (req: AdminReq, reply: FastifyReply) => {
    const ps = phaseState();
    const q = (req.query as Record<string, string | undefined>)?.q ?? '';
    const stuckOnly = (req.query as Record<string, string | undefined>)?.stuck === '1';
    const allPlayers = playerGrid.all() as Record<string, unknown>[];
    const visiblePlayers = filterPlayers(allPlayers, q, stuckOnly);

    const sparkSubmits = buildHourlyBuckets(submitsPerHour.all() as { bucket: string; n: number }[]);
    const sparkActive = buildHourlyBuckets(activePerHour.all() as { bucket: string; n: number }[]);
    const funnelRows = cohortFunnel.all() as { ordinal: number; n: number }[];
    const funnel: number[] = Array.from({ length: totalChallenges() }, () => 0);
    funnelRows.forEach((r) => { if (r.ordinal >= 1 && r.ordinal <= totalChallenges()) funnel[r.ordinal - 1] = r.n; });

    return reply.view('admin/dashboard.ejs', {
      players: allPlayers,
      visiblePlayers,
      events: recentEvents.all(),
      audit: recentAudit.all(),
      stuck: stuckCandidates.all(),
      challenges,
      total: totalChallenges(),
      phase: ps.phase,
      launchAt: ps.launchAt?.toISOString() ?? null,
      endAt: ps.endAt?.toISOString() ?? null,
      mailConfigured: mail.isConfigured(),
      adminEmail: req.adminEmail ?? '',
      variation: readVariation(req),
      q,
      stuckOnly,
      sparkSubmits,
      sparkActive,
      funnel,
      ...hintCtx,
    });
  });

  // ── Dedicated full-page screens (sidenav targets) ─────────────────────
  // Each reuses the same shell (topbar + sidenav partials) and serves the
  // same data the dashboard overview already aggregates. Heavy queries are
  // memoized via prepared statements at module load.

  // Rate-limited inline (60/min/IP): admin read, generous cap as a DoS guard.
  app.get('/admin/players', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req: AdminReq, reply: FastifyReply) => {
    const ps = phaseState();
    const q = (req.query as Record<string, string | undefined>)?.q ?? '';
    const stuckOnly = (req.query as Record<string, string | undefined>)?.stuck === '1';
    const filter = (req.query as Record<string, string | undefined>)?.filter ?? 'all';
    const sort = (req.query as Record<string, string | undefined>)?.sort ?? 'stage';
    const tab = (req.query as Record<string, string | undefined>)?.tab ?? 'roster';
    const allPlayers = playerGrid.all() as Record<string, unknown>[];
    const visiblePlayers = filterPlayers(allPlayers, q, stuckOnly);
    const stuckRows = stuckCandidates.all() as Record<string, unknown>[];

    // PR2 invitation data — only computed when the relevant tab is active so
    // roster renders stay cheap.
    let inviteRows: ReturnType<typeof invitations.listAll> = [];
    let inviteStats = { sent: 0, pending: 0, accepted: 0, declined: 0, expired: 0, accept_rate: 0, awaiting_claim: 0, slots_in_pool: 0 };
    let inviteOperators: { id: number; alias: string }[] = [];
    let requestRows: ReturnType<typeof inviteRequests.listAll> = [];
    let requestStats = { pending: 0, approved: 0, denied: 0, approval_rate: 0, avg_ttd: '—' };

    if (tab === 'invitations' || tab === 'requests') {
      invitations.sweepExpired();
    }
    if (tab === 'invitations') {
      inviteRows = invitations.listAll();
      inviteOperators = db.prepare(`
        SELECT id, alias FROM users
        WHERE verified_at IS NOT NULL
        ORDER BY alias COLLATE NOCASE
      `).all() as { id: number; alias: string }[];
      const s = inviteRows.reduce((acc, r) => {
        acc.sent++;
        if (r.status === 'pending') acc.pending++;
        else if (r.status === 'accepted') acc.accepted++;
        else if (r.status === 'revoked') acc.declined++;
        else if (r.status === 'expired') acc.expired++;
        return acc;
      }, { sent: 0, pending: 0, accepted: 0, declined: 0, expired: 0 });
      const decided = s.sent - s.pending;
      const accept_rate = decided > 0 ? Math.round((s.accepted / decided) * 100) : 0;
      const verifiedCount = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE verified_at IS NOT NULL`).get() as { n: number }).n;
      inviteStats = { ...s, accept_rate, awaiting_claim: s.pending, slots_in_pool: verifiedCount * invitations.getLimit() };
    }
    if (tab === 'requests') {
      requestRows = inviteRequests.listAll();
      let totalDecidedMs = 0, decidedCount = 0;
      const s = requestRows.reduce((acc, r) => {
        if (r.status === 'pending') acc.pending++;
        else if (r.status === 'approved') acc.approved++;
        else if (r.status === 'denied') acc.denied++;
        if (r.decided_at && r.created_at) {
          const ms = new Date(r.decided_at).getTime() - new Date(r.created_at).getTime();
          if (ms >= 0) { totalDecidedMs += ms; decidedCount++; }
        }
        return acc;
      }, { pending: 0, approved: 0, denied: 0 });
      const decided = s.approved + s.denied;
      const approval_rate = decided > 0 ? Math.round((s.approved / decided) * 100) : 0;
      let avg_ttd = '—';
      if (decidedCount > 0) {
        const hours = (totalDecidedMs / decidedCount) / 3_600_000;
        avg_ttd = hours < 1 ? `${Math.round(hours * 60)}m` : `${Math.round(hours)}h`;
      }
      requestStats = { ...s, approval_rate, avg_ttd };
    }

    // ?saved=1 flips after a successful POST /admin/players/templates
    // redirects back. Surfaced as a chrome chip in the email-templates header.
    const savedFlag = (req.query as Record<string, string | undefined>)?.saved === '1';

    return reply.view('admin/players.ejs', {
      players: allPlayers,
      visiblePlayers,
      stuck: stuckRows,
      challenges,
      total: totalChallenges(),
      phase: ps.phase,
      launchAt: ps.launchAt?.toISOString() ?? null,
      endAt: ps.endAt?.toISOString() ?? null,
      mailConfigured: mail.isConfigured(),
      adminEmail: req.adminEmail ?? '',
      variation: readVariation(req),
      q, stuckOnly, filter, sort, tab,
      inviteRows, inviteStats, inviteOperators, requestRows, requestStats,
      inviteLimit: invitations.getLimit(),
      inviteTtlLabel: invitations.expiresInLabel(),
      settings: settings.getAll(),
      saved: savedFlag,
      ...hintCtx,
    });
  });

  app.get('/admin/feed', async (req: AdminReq, reply: FastifyReply) => {
    const ps = phaseState();
    const allPlayers = playerGrid.all() as Record<string, unknown>[];
    const stuckRows = stuckCandidates.all() as Record<string, unknown>[];
    const events = recentEvents.all() as Record<string, unknown>[];

    // events-per-minute: bucket the last 24 minutes from `events`
    const now = Date.now();
    const buckets: number[] = Array(24).fill(0);
    for (const e of events) {
      const ts = e.created_at ? new Date(e.created_at as string).getTime() : 0;
      if (!ts) continue;
      const minsAgo = Math.floor((now - ts) / 60_000);
      if (minsAgo >= 0 && minsAgo < 24) buckets[23 - minsAgo] += 1;
    }
    const kindCounts: Record<string, number> = {};
    for (const e of events) {
      const k = String(e.kind ?? 'attempt');
      kindCounts[k] = (kindCounts[k] || 0) + 1;
    }
    const emitterMap: Record<string, number> = {};
    for (const e of events) {
      const a = String(e.alias ?? '—');
      emitterMap[a] = (emitterMap[a] || 0) + 1;
    }
    const topEmitters = Object.entries(emitterMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

    return reply.view('admin/feed.ejs', {
      events,
      buckets,
      kindCounts,
      topEmitters,
      players: allPlayers,
      stuckCount: stuckRows.length,
      challenges,
      total: totalChallenges(),
      phase: ps.phase,
      launchAt: ps.launchAt?.toISOString() ?? null,
      endAt: ps.endAt?.toISOString() ?? null,
      mailConfigured: mail.isConfigured(),
      adminEmail: req.adminEmail ?? '',
      variation: readVariation(req),
      ...hintCtx,
    });
  });

  app.get('/admin/hints', async (req: AdminReq, reply: FastifyReply) => {
    const ps = phaseState();
    const allPlayers = playerGrid.all() as Record<string, unknown>[];
    const stuckRows = stuckCandidates.all() as Record<string, unknown>[];
    const selectedAlias = (req.query as Record<string, string | undefined>)?.s ?? null;

    // Resolve the canned hints for the currently-selected candidate so the
    // textarea can be seeded server-side. Mirrors the .ejs's selection logic.
    let cannedHints: Record<`hint${HintLevel}`, string> | null = null;
    // Mirror the template's selection chain exactly: try the alias, then fall
    // back to the first stuck row. Otherwise a stale `?s=alias` link renders
    // the page with a real candidate but an empty textarea.
    const selected =
      (selectedAlias ? stuckRows.find((h) => h.alias === selectedAlias) : undefined) ??
      stuckRows[0];
    if (selected) {
      const ch = challenges.find((c) => c.ordinal === selected.current_ordinal);
      if (ch) cannedHints = { ...handlerFor(ch).hints };
    }

    return reply.view('admin/hints.ejs', {
      hints: stuckRows,
      players: allPlayers,
      stuckCount: stuckRows.length,
      challenges,
      total: totalChallenges(),
      phase: ps.phase,
      launchAt: ps.launchAt?.toISOString() ?? null,
      endAt: ps.endAt?.toISOString() ?? null,
      mailConfigured: mail.isConfigured(),
      adminEmail: req.adminEmail ?? '',
      variation: readVariation(req),
      selectedAlias,
      cannedHints,
      maxHintBody: MAX_HINT_BODY,
      ...hintCtx,
    });
  });

  // Flip dense ↔ narrative. Form-POST so it works without JS.
  app.post('/admin/variation', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const v: Variation = body.v === 'narrative' ? 'narrative' : 'dense';
    reply.setCookie(VARIATION_COOKIE, v, {
      path: '/admin',
      httpOnly: false, // readable by client JS for instant toggle
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 365,
    });
    return reply.redirect('/admin');
  });

  // Skip a player past their current stage. (Form fallback.)
  app.post('/admin/skip', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const userId = Number.parseInt(body.user_id, 10);
    const ordinal = Number.parseInt(body.ordinal, 10);
    if (!userId || !ordinal) return reply.code(400).send({ error: 'bad params' });
    const ok = adminSkip(userId, ordinal);
    audit(req.adminEmail!, 'skip', String(userId), { ordinal, ok }, req.ip);
    return reply.redirect('/admin');
  });

  // Send a hint to a specific player at a specific level. (Form fallback.)
  app.post('/admin/hint', async (req: AdminReq, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const userId = Number.parseInt(body.user_id, 10);
    const challengeId = body.challenge_id;
    const lvl = Number.parseInt(body.level, 10);
    if (!userId || !challengeId || !isHintLevel(lvl)) {
      return reply.code(400).send({ error: 'bad params' });
    }
    const bodyOverride = typeof body.body === 'string' ? body.body : null;
    if (bodyOverride !== null && bodyOverride.length > MAX_HINT_BODY) {
      return reply.code(400).send({ error: 'body too long' });
    }
    const r = await dispatchHint(req.adminEmail!, req.ip, userId, challengeId, lvl, bodyOverride);
    if (!r.ok) return reply.code(404).send({ error: r.error });
    return reply.redirect('/admin');
  });

  // ── JSON API (drawer + live feed) ─────────────────────────────────────

  app.get('/admin/api/player/:id', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const row = playerById.get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'unknown user' });
    const attempts = playerAttempts.all(id) as Record<string, unknown>[];
    const stage = (row.current_ordinal as number) ?? 1;
    const challengeMeta = challenges.find((c) => c.ordinal === stage) ?? null;
    const flagSalt = String(row.flag_salt ?? '');
    const strikes = listStrikesForSupplier(id);
    return {
      id: row.id,
      alias: row.alias,
      email: row.email,
      flagSaltPrefix: flagSalt.slice(0, 8) + '…',
      stage,
      total: totalChallenges(),
      currentChallenge: challengeMeta && {
        id: challengeMeta.id,
        title: challengeMeta.title,
        category: challengeMeta.category,
        points: challengeMeta.points,
      },
      lastAdvanceAt: row.last_advance_at,
      adminSkips: row.admin_skips ?? 0,
      solves: row.solves ?? 0,
      skipSolves: row.skip_solves ?? 0,
      hintsUsed: row.hints_used ?? 0,
      attemptsTotal: row.attempts ?? 0,
      completedAt: row.completed_at ?? null,
      verifiedAt: row.verified_at ?? null,
      createdAt: row.created_at ?? null,
      frozenAt: row.frozen_at ?? null,
      frozenReason: row.frozen_reason ?? null,
      cheatStrikes: row.cheat_strikes ?? 0,
      strikeHistory: strikes.map((s) => ({
        id: s.id,
        consumerId: s.consumer_id,
        challengeId: s.challenge_id,
        detectedAt: s.detected_at,
        acknowledgedAt: s.acknowledged_at ?? null,
        strikeNumber: s.strike_number,
      })),
      recentAttempts: attempts.map((a) => ({
        challengeId: a.challenge_id,
        ordinal: a.ordinal,
        title: a.title,
        submitted: a.submitted,
        correct: !!a.correct,
        createdAt: a.created_at,
      })),
    };
  });

  app.post('/admin/api/player/:id/skip', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ordinal = Number.parseInt(String(body.ordinal ?? ''), 10);
    if (!ordinal) return reply.code(400).send({ error: 'bad ordinal' });
    const ok = adminSkip(id, ordinal);
    audit(req.adminEmail!, 'skip', String(id), { ordinal, ok }, req.ip);
    return { ok };
  });

  app.post('/admin/api/player/:id/hint', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const challengeId = String(body.challenge_id ?? '');
    const lvl = Number.parseInt(String(body.level ?? ''), 10);
    if (!challengeId || !isHintLevel(lvl)) return reply.code(400).send({ error: 'bad params' });
    const bodyOverride = typeof body.body === 'string' ? body.body : null;
    if (bodyOverride !== null && bodyOverride.length > MAX_HINT_BODY) {
      return reply.code(400).send({ error: 'body too long' });
    }
    const r = await dispatchHint(req.adminEmail!, req.ip, id, challengeId, lvl, bodyOverride);
    if (!r.ok) return reply.code(404).send({ error: r.error });
    return { ok: true, mailOk: r.mailOk };
  });

  app.get('/admin/api/events', async (req: AdminReq, _reply) => {
    const since = Number.parseInt(String((req.query as Record<string, string>)?.since ?? '0'), 10) || 0;
    const rows = eventsSince.all(since) as Record<string, unknown>[];
    return { events: rows };
  });

  // Cheat-detection recovery: unfreeze (clears frozen_at/reason) and
  // clear-strikes (resets the counter + acks all queue rows). Kept separate
  // so an admin can drop a strike-1 without unfreezing a strike-2 freeze,
  // and vice versa.
  app.post('/admin/api/player/:id/unfreeze', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const ok = adminUnfreeze(id);
    audit(req.adminEmail!, 'player_unfreeze', String(id), { ok }, req.ip);
    return { ok };
  });

  app.post('/admin/api/player/:id/clear-strikes', async (req: AdminReq, reply) => {
    const id = Number.parseInt((req.params as Record<string, string>).id, 10);
    if (!id) return reply.code(400).send({ error: 'bad id' });
    const r = adminClearStrikes(id);
    audit(req.adminEmail!, 'player_clear_strikes', String(id), r, req.ip);
    return { ok: true, ...r };
  });
}
