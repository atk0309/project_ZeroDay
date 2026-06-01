// Maps challenge id → handler module. Authored handlers shadow the stub.
import { challenges, type ChallengeMeta } from '../registry.js';
import type { ChallengeModule } from '../types.js';
import { makeStub } from './stub.js';
import { handler as whiteRabbit } from './white-rabbit.js';
import { handler as noSpoon } from './no-spoon.js';
import { handler as caesarsGhost } from './caesars-ghost.js';
import { handler as cookieFlip } from './cookie-flip.js';
import { handler as headers } from './headers.js';
import { handler as dnsWhispers } from './dns-whispers.js';
import { handler as matryoshka } from './matryoshka.js';
import { handler as gibson404 } from './gibson-404.js';
import { handler as clientCinema } from './client-cinema.js';
import { handler as methodMadness } from './method-madness.js';
import { handler as regexRunes } from './regex-runes.js';
import { handler as xorOracle } from './xor-oracle.js';
import { handler as portsOfCall } from './ports-of-call.js';
import { handler as shallWePlay } from './shall-we-play.js';
import { handler as crackWopr } from './crack-wopr.js';
import { handler as gitArchaeology } from './git-archaeology.js';
import { handler as stegoStatic } from './stego-static.js';
import { handler as ghostShell } from './ghost-shell.js';
import { handler as hackThePlanet } from './hack-the-planet.js';

const authored: Record<string, ChallengeModule> = {
  'white-rabbit': whiteRabbit,
  'no-spoon': noSpoon,
  'caesars-ghost': caesarsGhost,
  'cookie-flip': cookieFlip,
  'headers': headers,
  'dns-whispers': dnsWhispers,
  'matryoshka': matryoshka,
  'gibson-404': gibson404,
  'client-cinema': clientCinema,
  'method-madness': methodMadness,
  'regex-runes': regexRunes,
  'xor-oracle': xorOracle,
  'ports-of-call': portsOfCall,
  'shall-we-play': shallWePlay,
  'crack-wopr': crackWopr,
  'git-archaeology': gitArchaeology,
  'stego-static': stegoStatic,
  'ghost-shell': ghostShell,
  'hack-the-planet': hackThePlanet,
};

const handlerMap = new Map<string, ChallengeModule>();
for (const c of challenges) {
  handlerMap.set(c.id, authored[c.id] ?? makeStub(c));
}

export function handlerFor(meta: ChallengeMeta): ChallengeModule {
  return handlerMap.get(meta.id)!; // map covers every id by construction
}

// Source of truth for the /admin/setup readiness checklist. Anything in the
// `authored` map above is counted; new authored handlers light up automatically.
export function authoredChallengeIds(): string[] {
  return Object.keys(authored);
}

export function isAuthored(id: string): boolean {
  return id in authored;
}
