// Generic stub for challenges not yet authored. Renders a CRT placeholder card
// with the challenge title and a "coming soon" note. The flag IS rendered (so
// the engine remains testable end-to-end), gated behind a ?reveal=1 query.
//
// As each puzzle is authored, replace the stub mapping in handlers/index.ts.

import type { ChallengeMeta } from '../registry.js';
import type { ChallengeModule } from '../types.js';

export function makeStub(meta: ChallengeMeta): ChallengeModule {
  return {
    hints: {
      hint1: `(${meta.title}) — content not yet authored.`,
      hint2: 'check back; an operator will publish this trial soon.',
      hint3: 'no shortcut from inside the trial. ask in chat or wait for content.',
      hint4: 'this stage is genuinely empty. an admin can skip you past it if you ask.',
      hint5: 'if you really need to advance, ask for an admin skip.',
    },
    async page(req, reply, { flag }) {
      const url = new URL(req.url, 'http://x');
      const reveal = url.searchParams.get('reveal') === '1';
      const body = `<!doctype html>
<html><head><title>${meta.title}</title>
<style>body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;}</style>
</head><body>
<pre>
  > ${meta.title}
  > stage ${meta.ordinal}/19 — ${meta.category} — ${meta.points} pts
  > status: AWAITING CONTENT

  this trial has not yet been authored.
  ${reveal ? `\n  bypass flag (testing only): ${flag}` : ''}
</pre>
</body></html>`;
      reply.type('text/html').send(body);
    },
  };
}
