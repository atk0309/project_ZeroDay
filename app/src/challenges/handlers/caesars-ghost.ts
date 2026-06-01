// Challenge 3 — Caesar's ghost.
// ROT13 of a Mitnick quote, signed off with the player's flag also ROT13'd.
import type { ChallengeModule } from '../types.js';

function rot13(s: string): string {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const QUOTE = "The art of deception is in convincing people you're someone else.";

const html = (flagRot: string) => `<!doctype html>
<html><head><title>oracle: caesar</title>
<style>body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;}</style>
</head><body>
<pre>
  > intercepted transmission, encoding unknown
  ${rot13(QUOTE)}
  ${flagRot}
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the oracle speaks, but not in plain english. read carefully.',
    hint2: 'this is a cipher older than the internet by two thousand years.',
    hint3: 'romans had a way. shift letters by a little. or a lot.',
    hint4: 'this is ROT13. each letter shifts by 13.',
    hint5: 'paste the bottom line into a ROT13 decoder. the result is the flag.',
  },
  async page(_req, reply, { flag }) {
    // Note: we ROT13 the *flag itself* so they have to decode to get it.
    // The braces and ZERODAY{} survive ROT13 because they aren't letters... mostly.
    reply.type('text/html').send(html(rot13(flag)));
  },
};
