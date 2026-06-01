// Shape every challenge module exports. Keeps puzzle logic in one file per challenge.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '../lib/playerAuth.js';

export interface ChallengeRender {
  // Returns rendered HTML or sends the response itself. Receives the player and
  // their generated flag so the puzzle can embed it in HTML / cookies / headers.
  page: (req: FastifyRequest, reply: FastifyReply, ctx: { user: User; flag: string }) => Promise<unknown> | unknown;
}

export interface ChallengeHints {
  hint1: string; // L1 nudge       —  1pt
  hint2: string; // L2 direction   —  2pt
  hint3: string; // L3 technique   —  4pt
  hint4: string; // L4 strong      —  7pt
  hint5: string; // L5 near-spoiler — 10pt
}

export interface ChallengeModule extends ChallengeRender {
  hints: ChallengeHints;
}
