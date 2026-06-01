// Loads the current player onto the request. Doesn't enforce — that's per-route.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PLAYER_COOKIE, readSession, type User } from '../lib/playerAuth.js';
import { unacknowledgedStrikes } from '../lib/cheat.js';

export interface PlayerRequest extends FastifyRequest {
  player?: User;
}

export async function loadPlayer(req: PlayerRequest) {
  const sid = req.cookies?.[PLAYER_COOKIE];
  const user = readSession(sid);
  if (user) req.player = user;
}

export async function requirePlayer(req: PlayerRequest, reply: FastifyReply) {
  await loadPlayer(req);
  if (!req.player) return reply.redirect('/recruit');
}

// Paths that must remain reachable for a frozen / struck player so the UX
// can land them on the right experience screen.
const FROZEN_BYPASS_PATHS = new Set(['/frozen', '/strike-notice', '/strike-notice/ack']);

function isJsonRoute(url: string): boolean {
  return url.startsWith('/api/');
}

// Call AFTER requirePlayer (req.player is set). Enforces:
//   - frozen accounts → 423 (api) or redirect to /frozen (html)
//   - unack'd cheat strikes (supplier-side) → one-shot redirect to
//     /strike-notice for HTML routes; api routes pass through (so polling
//     doesn't loop or surface the experience to the wrong audience).
//
// Returns true if the request was handled (caller should stop). False means
// continue.
export async function enforcePlayerState(req: PlayerRequest, reply: FastifyReply): Promise<boolean> {
  const player = req.player;
  if (!player) return false;
  const url = req.url;
  const path = url.split('?')[0];

  if (player.frozen_at) {
    if (FROZEN_BYPASS_PATHS.has(path)) return false;
    if (isJsonRoute(url)) {
      reply.code(423).send({ error: 'frozen', reason: player.frozen_reason ?? 'frozen' });
      return true;
    }
    reply.redirect('/frozen');
    return true;
  }

  // Strike notice only intercepts HTML routes — API polling stays clean.
  if (!isJsonRoute(url) && !FROZEN_BYPASS_PATHS.has(path)) {
    const unack = unacknowledgedStrikes(player.id);
    if (unack.length > 0) {
      reply.redirect('/strike-notice');
      return true;
    }
  }
  return false;
}
