// Flag-submit endpoint. Sequential model: only the player's *current* ordinal
// can advance them. Wrong submits to other ordinals are recorded but never
// advance progress.

import type { FastifyInstance } from 'fastify';
import { phase } from '../lib/phase.js';
import { challenges, challengeByOrdinal, totalChallenges } from '../challenges/registry.js';
import { generateFlag, verifyFlag } from '../lib/flags.js';
import { getProgress, recordCorrectSubmit, recordWrongSubmit } from '../lib/progress.js';
import { detectFlagSupplier } from '../lib/cheatDetect.js';
import { recordCheatDetection } from '../lib/cheat.js';
import { enforcePlayerState, requirePlayer, type PlayerRequest } from '../middleware/playerAuthMiddleware.js';

export async function submitRoutes(app: FastifyInstance) {
  // Per-route rate limit declared INLINE in the route options (not via an
  // onRoute hook) so CodeQL's js/missing-rate-limiting query can statically see
  // it. 5/min/IP throttles brute-force flag guessing without hurting honest play.
  app.post('/api/submit', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: PlayerRequest, reply) => {
    await requirePlayer(req, reply);
    if (!req.player) return;
    if (await enforcePlayerState(req, reply)) return;
    const ph = phase();
    if (ph === 'uninitialized' || ph === 'prelaunch') {
      return reply.code(423).send({ error: 'transmission window closed' });
    }
    if (ph === 'frozen') {
      return reply.code(423).send({ error: 'transmission ended' });
    }

    const body = (req.body ?? {}) as { challenge_id?: string; flag?: string };
    if (!body.challenge_id || !body.flag) {
      return reply.code(400).send({ error: 'missing challenge_id or flag' });
    }
    const meta = challenges.find((c) => c.id === body.challenge_id);
    if (!meta) return reply.code(404).send({ error: 'unknown challenge' });

    const progress = getProgress(req.player.id);
    const cur = progress?.current_ordinal ?? 1;
    if (meta.ordinal !== cur) {
      // Only the current ordinal can advance; refuse before checking the flag
      // so we don't leak whether their guess for a future challenge was right.
      return reply.code(403).send({ error: 'not your current stage', current: cur });
    }

    const ok = verifyFlag(req.player, meta.id, body.flag);
    const ip = req.ip;
    const ua = req.headers['user-agent'] ?? null;
    if (!ok) {
      // Anti-cheat: before logging the wrong attempt as a normal miss, check
      // whether the submitted string is actually another operator's flag.
      // detectFlagSupplier fast-fails on non-flag-shaped input.
      const supplier = detectFlagSupplier(body.flag, meta.id, req.player.id);
      if (supplier) {
        const result = recordCheatDetection({
          consumerId: req.player.id,
          supplierId: supplier.supplierId,
          challengeId: meta.id,
          submitted: body.flag,
          ip,
          ua,
        });
        // Trigger payload for the consumer-side dramatic takeover. The user is
        // designing the actual UI; this carries the data hooks they'll need.
        return reply.code(200).send({
          correct: false,
          cheat: {
            detected: true,
            supplier_alias: supplier.supplierAlias,
            strike_number: result.strikeNumber,
            supplier_frozen: result.supplierFrozen,
          },
        });
      }
      recordWrongSubmit(req.player.id, meta.id, body.flag, ip, ua);
      return reply.code(200).send({ correct: false });
    }
    const r = recordCorrectSubmit(req.player.id, meta.id, meta.ordinal, ip, ua);
    return reply.code(200).send({
      correct: true,
      advanced: r.advanced,
      completed: r.completed,
      next: meta.ordinal < totalChallenges() ? meta.ordinal + 1 : null,
    });
  });

  // Echo helper — lets the hub display the flag submit form pointed at the
  // current challenge id without exposing all challenge ids in HTML.
  app.get('/api/me', async (req: PlayerRequest, reply) => {
    await requirePlayer(req, reply);
    if (!req.player) return;
    const progress = getProgress(req.player.id);
    const cur = progress?.current_ordinal ?? 1;
    const meta = challengeByOrdinal(cur);
    return {
      alias: req.player.alias,
      current_ordinal: cur,
      current_challenge_id: meta?.id ?? null,
      completed: !!progress?.completed_at,
      // Note: we DO NOT return the flag here. Generated only on render.
      _expected_flag_preview: process.env.NODE_ENV === 'development' && meta ? generateFlag(req.player, meta.id) : undefined,
    };
  });
}
