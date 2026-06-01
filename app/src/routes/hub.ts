// Player hub — the main terminal at hack.example.com.
// Renders different content depending on phase + progress.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { phaseState, type PhaseState } from '../lib/phase.js';
import * as content from '../lib/content.js';
import { challenges, totalChallenges } from '../challenges/registry.js';
import { getProgress } from '../lib/progress.js';
import { generateFlag } from '../lib/flags.js';
import { handlerFor } from '../challenges/handlers/index.js';
import { enforcePlayerState, loadPlayer, requirePlayer, type PlayerRequest } from '../middleware/playerAuthMiddleware.js';
import { db } from '../db/index.js';
import * as invitations from '../lib/invitations.js';
import * as inviteRequests from '../lib/inviteRequests.js';

const recentSolves = db.prepare(`
  SELECT challenge_id FROM solves WHERE user_id = ? ORDER BY solved_at ASC
`);
const hintsForUser = db.prepare(`
  SELECT challenge_id, COUNT(*) as count FROM hints_sent WHERE user_id = ? GROUP BY challenge_id
`);
// Cohort wall (handles only, oldest first) + slot number for the lobby.
const cohortAliases = db.prepare(`
  SELECT id, alias FROM users
  WHERE verified_at IS NOT NULL
  ORDER BY id ASC
`);

// Live-focus extras: per-trial attempt log, cohort stats, and leaderboard.
// Placed at module load (top-level db.prepare) per house convention.
const recentAttemptsOnTrial = db.prepare(`
  SELECT submitted, correct, created_at FROM attempts
  WHERE user_id = ? AND challenge_id = ?
  ORDER BY id DESC LIMIT 5
`);
const attemptsCountOnTrial = db.prepare(`
  SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND challenge_id = ?
`);
const cohortSolvedCount = db.prepare(`
  SELECT COUNT(*) AS n FROM solves WHERE challenge_id = ?
`);
const firstBlood = db.prepare(`
  SELECT u.alias FROM solves s JOIN users u ON u.id = s.user_id
  WHERE s.challenge_id = ? AND s.flag_source = 'player'
  ORDER BY s.solved_at ASC LIMIT 1
`);
const liveLeaderboard = db.prepare(`
  SELECT
    u.id                                          AS user_id,
    u.alias                                       AS alias,
    p.current_ordinal                             AS stage,
    p.last_advance_at                             AS last_advance_at,
    p.admin_skips                                 AS admin_skips,
    COALESCE((SELECT SUM(c.points)
              FROM solves s
              JOIN challenges c ON c.id = s.challenge_id
              WHERE s.user_id = u.id AND s.flag_source = 'player'), 0) AS points,
    COALESCE((SELECT COUNT(*) FROM hints_sent h WHERE h.user_id = u.id), 0) AS hints,
    p.completed_at                                AS completed_at
  FROM users u
  LEFT JOIN user_progress p ON p.user_id = u.id
  WHERE u.verified_at IS NOT NULL
  ORDER BY p.current_ordinal DESC, p.last_advance_at ASC
  LIMIT 200
`);

// Renders the Focus-layout operator lobby (hub.ejs) for both 'live' and
// 'frozen' phases. Caller must already have authenticated the player and
// passed enforcePlayerState. Phase must be 'live' or 'frozen'.
async function renderHubLobby(req: PlayerRequest, reply: FastifyReply, ps: PhaseState) {
  const progress = getProgress(req.player!.id);
  const cur = progress?.current_ordinal ?? 1;
  const solved = new Set((recentSolves.all(req.player!.id) as { challenge_id: string }[]).map((r) => r.challenge_id));
  const hintCounts = new Map<string, number>(
    (hintsForUser.all(req.player!.id) as { challenge_id: string; count: number }[]).map((r) => [r.challenge_id, r.count])
  );

  const board = liveLeaderboard.all() as Array<{
    user_id: number;
    alias: string;
    stage: number | null;
    last_advance_at: string | null;
    admin_skips: number | null;
    points: number;
    hints: number;
    completed_at: string | null;
  }>;
  // Dense rank by (points DESC, stage DESC, alias ASC) — players share a rank
  // only when both points AND stage match (alias is just a stable tiebreaker
  // for display order, not a rank-affecting key).
  const sorted = [...board].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if ((b.stage ?? 0) !== (a.stage ?? 0)) return (b.stage ?? 0) - (a.stage ?? 0);
    return a.alias.localeCompare(b.alias);
  });
  let lastPts: number | null = null;
  let lastStage: number | null = null;
  let lastRank = 0;
  const ranked = sorted.map((p, i) => {
    const stage = p.stage ?? 0;
    let rank = i + 1;
    if (p.points === lastPts && stage === lastStage) rank = lastRank;
    else { lastRank = rank; lastPts = p.points; lastStage = stage; }
    return { ...p, rank, isMe: p.user_id === req.player!.id };
  });
  const myRow = ranked.find((r) => r.isMe);
  const myRank = myRow?.rank ?? null;
  const myPoints = myRow?.points ?? 0;
  const myHintsTotal = myRow?.hints ?? 0;

  const completed = !!progress?.completed_at;
  const currentTrial = !completed ? challenges.find((c) => c.ordinal === cur) ?? null : null;
  let attemptsOnCurrent = 0;
  let recentAttempts: Array<{ submitted: string; correct: number; created_at: string }> = [];
  let cohortSolved = 0;
  let firstBloodAlias: string | null = null;
  let hintsOnCurrent = 0;
  if (currentTrial) {
    attemptsOnCurrent = (attemptsCountOnTrial.get(req.player!.id, currentTrial.id) as { n: number }).n;
    recentAttempts = recentAttemptsOnTrial.all(req.player!.id, currentTrial.id) as typeof recentAttempts;
    cohortSolved = (cohortSolvedCount.get(currentTrial.id) as { n: number }).n;
    const fb = firstBlood.get(currentTrial.id) as { alias: string } | undefined;
    firstBloodAlias = fb?.alias ?? null;
    hintsOnCurrent = hintCounts.get(currentTrial.id) ?? 0;
  }

  const cohortRows = cohortAliases.all() as { id: number }[];
  const cohortTotal = cohortRows.length;
  const slotIdx = cohortRows.findIndex((r) => r.id === req.player!.id);
  const slotNumber = slotIdx >= 0 ? String(slotIdx + 1).padStart(3, '0') : '—';

  return reply.view('hub.ejs', {
    alias: req.player!.alias,
    challenges,
    currentOrdinal: cur,
    solved,
    hintCounts,
    total: totalChallenges(),
    launchAt: ps.launchAt!.toISOString(),
    endAt: ps.endAt!.toISOString(),
    phase: ps.phase,
    completed,
    currentTrial,
    recentAttempts,
    attemptsOnCurrent,
    cohortSolved,
    cohortTotal,
    firstBloodAlias,
    hintsOnCurrent,
    lastAdvanceAt: progress?.last_advance_at ?? null,
    myPoints,
    myHintsTotal,
    myRank,
    slotNumber,
    leaderboard: ranked,
  });
}

export async function hubRoutes(app: FastifyInstance) {
  // Hub root.
  app.get('/', async (req: PlayerRequest, reply) => {
    await loadPlayer(req);
    const ps = phaseState();

    if (ps.phase === 'uninitialized') {
      return reply.view('uninitialized.ejs', {});
    }

    if (!req.player) {
      // No session → recruit landing.
      return reply.redirect('/recruit');
    }

    if (await enforcePlayerState(req, reply)) return;

    if (ps.phase === 'prelaunch') {
      const flavor = content.lobbyFlavorLines();
      const rows = cohortAliases.all() as { id: number; alias: string }[];
      const cohort = rows.map((r) => r.alias);
      const myIndex = rows.findIndex((r) => r.id === req.player!.id);
      const slotNumber = myIndex >= 0 ? String(myIndex + 1).padStart(3, '0') : '—';

      // Invitations: quota + slots + history.
      const inviteQuota = invitations.quotaFor(req.player.id);
      const myInvites = invitations.listForInviter(req.player.id);
      const activeStatuses = new Set(['pending', 'accepted']);
      const active = myInvites.filter((i) => activeStatuses.has(i.status));
      const inviteSlots: (typeof myInvites[number] | null)[] = [];
      for (let i = 0; i < inviteQuota.limit; i++) inviteSlots.push(active[i] ?? null);
      const inviteHistory = myInvites.filter((i) => !activeStatuses.has(i.status)).slice(0, 8);

      // Pending request (operator may have ≤1 outstanding).
      const myRequests = inviteRequests.listForRequester(req.player.id);
      const pendingRequest = myRequests.find((r) => r.status === 'pending') ?? null;

      // ?msg=… flash banner. devLink piggybacks for offline-mail playtesters.
      const q = (req.query as Record<string, string | undefined>) ?? {};
      const flashMsg = q.msg ?? null;
      const devLink = q.dev_link ?? null;

      return reply.view('lobby.ejs', {
        alias: req.player.alias,
        launchAt: ps.launchAt!.toISOString(),
        flavor,
        cohort,
        slotNumber,
        inviteQuota,
        inviteSlots,
        inviteHistory,
        pendingRequest,
        flashMsg,
        devLink,
        inviteTtlLabel: invitations.expiresInLabel(),
      });
    }

    // Both 'live' and 'frozen' render the focus-layout console (hub.ejs).
    // Frozen swaps the active task card for a lights-out panel; final
    // standings still come from the same leaderboard query.
    return renderHubLobby(req, reply, ps);
  });

  // Operator manual — narrative onboarding briefing. Static, no auth gate.
  // Linked from the lobby topbar and the admin dashboard topbar menu.
  app.get('/manual', async (_req, reply) => {
    return reply.view('manual.ejs', {});
  });

  // Per-challenge route. Path: /c/:ordinal — but the actual puzzle page may be
  // host-routed (e.g. example.com/ for challenge 1). The /c/:ordinal route is
  // the canonical entry from the hub.
  //
  // The wildcard variant /c/:ordinal/* lets handlers serve sub-paths from the
  // hub host too (e.g. /c/1/matrix, /c/1/robots.txt, /c/8/sys/console). On
  // production the puzzles are reachable on their host-routed subdomain; on
  // staging or any single-host deploy this is the only way to follow the
  // breadcrumb. Before dispatch we rewrite req.url to the puzzle-relative path
  // so handlers (which read req.url) see the same input shape as the
  // subdomain dispatch in server.ts.
  const dispatchChallenge = async (req: PlayerRequest, reply: import('fastify').FastifyReply, subpath: string | null) => {
    await requirePlayer(req, reply);
    if (!req.player) return;
    if (await enforcePlayerState(req, reply)) return;
    const ps = phaseState();
    if (ps.phase === 'uninitialized') return reply.view('uninitialized.ejs', {});
    if (ps.phase === 'prelaunch') return reply.redirect('/');
    const ordinal = Number.parseInt((req.params as { ordinal: string }).ordinal, 10);
    const meta = challenges.find((c) => c.ordinal === ordinal);
    if (!meta) return reply.code(404).view('locked.ejs', { reason: 'unknown stage', currentOrdinal: 1 });

    const progress = getProgress(req.player.id);
    const cur = progress?.current_ordinal ?? 1;
    if (ordinal > cur) {
      return reply.code(403).view('locked.ejs', { reason: 'PRIOR CLEARANCE REQUIRED', currentOrdinal: cur });
    }
    if (ps.phase === 'frozen' && ordinal === totalChallenges()) {
      // Final stage during frozen: render the lights-out focus lobby in
      // place of the handler so the per-player flag never enters the
      // response body.
      return renderHubLobby(req, reply, ps);
    }

    if (subpath !== null) {
      // Fastify's req.url is a getter that reads req.raw.url; mutate the raw
      // request so handlers (which inspect req.url) see the puzzle-relative
      // path, the same shape they'd see when host-routed in server.ts.
      req.raw.url = '/' + subpath;
    }

    const flag = generateFlag(req.player, meta.id);
    const handler = handlerFor(meta);
    return handler.page(req, reply, { user: req.player, flag });
  };

  app.get('/c/:ordinal', async (req: PlayerRequest, reply) => {
    return dispatchChallenge(req, reply, null);
  });

  app.get('/c/:ordinal/*', async (req: PlayerRequest, reply) => {
    const star = (req.params as { '*': string })['*'] ?? '';
    return dispatchChallenge(req, reply, star);
  });
}
