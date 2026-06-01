// /strike-notice — supplier-side first-login experience ("we have noticed").
// /frozen        — cheater takeover for the consumer who used another op's flag,
//                  also rendered for strike-2 suppliers and admin bans.
//
// Both routes intentionally bypass the strike-notice and frozen redirects in
// the player middleware (their paths are in FROZEN_BYPASS_PATHS). The visual
// design is in web/views/{strike-notice,account-frozen}.ejs + web/static/
// violation.css; this file just feeds them real data from `lib/cheat.ts`.

import type { FastifyInstance } from 'fastify';
import {
  acknowledgeStrikes,
  consumerEvidence,
  supplierDossier,
  unacknowledgedStrikes,
} from '../lib/cheat.js';
import { loadPlayer, requirePlayer, type PlayerRequest } from '../middleware/playerAuthMiddleware.js';

export async function strikeNoticeRoutes(app: FastifyInstance) {
  app.get('/strike-notice', async (req: PlayerRequest, reply) => {
    await requirePlayer(req, reply);
    if (!req.player) return;
    const unack = unacknowledgedStrikes(req.player.id);
    if (unack.length === 0) {
      return reply.redirect('/');
    }
    const dossier = supplierDossier(req.player.id);
    return reply.view('strike-notice.ejs', {
      alias: req.player.alias,
      playerEmail: req.player.email,
      strike: unack[0],
      totalStrikes: req.player.cheat_strikes,
      dossier,
    });
  });

  app.post('/strike-notice/ack', async (req: PlayerRequest, reply) => {
    await requirePlayer(req, reply);
    if (!req.player) return;
    acknowledgeStrikes(req.player.id);
    if (req.player.frozen_at) return reply.redirect('/frozen');
    return reply.redirect('/');
  });

  app.get('/frozen', async (req: PlayerRequest, reply) => {
    await loadPlayer(req);
    if (!req.player) return reply.redirect('/recruit');
    if (!req.player.frozen_at) return reply.redirect('/');
    const evidence = consumerEvidence(req.player.id);
    return reply.view('account-frozen.ejs', {
      alias: req.player.alias,
      reason: req.player.frozen_reason ?? 'frozen',
      detectedAt: req.player.frozen_at,
      evidence,
    });
  });
}
