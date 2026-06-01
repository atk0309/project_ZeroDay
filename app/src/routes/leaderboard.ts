// Public leaderboard. Sequential model:
//   primary sort: current_ordinal DESC
//   tiebreak:     last_advance_at ASC (fastest to reach this stage wins ties)
// Points + admin_skips badge shown alongside.

import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { totalChallenges } from '../challenges/registry.js';

const boardQuery = db.prepare(`
  SELECT
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

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get('/board', async (_req, reply) => {
    const rows = boardQuery.all();
    return reply.view('leaderboard.ejs', { rows, total: totalChallenges() });
  });
  app.get('/api/leaderboard', async () => {
    return { rows: boardQuery.all(), total: totalChallenges() };
  });
}
