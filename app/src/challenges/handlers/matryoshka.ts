// Challenge 7 — Matryoshka. Crypto. oracle.example.com.
// Embeds GIBSON key part 1 of 3.
//
// Mechanic: the page renders a single opaque blob, four veils thick. Layers,
// outermost to innermost: base64 → reverse-string → ROT13 → base64. Final
// cleartext: `flag=ZERODAY{...}\ngibson_key_part_1=<hex>`. Decoding both halves
// of the puzzle from the same chain — peeling = solving + key fragment in hand.
import type { ChallengeModule } from '../types.js';
import { GIBSON_KEY_PARTS } from '../../lib/gibson.js';

function b64encode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function reverseString(s: string): string {
  return Array.from(s).reverse().join('');
}

function rot13(s: string): string {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// Wrap inner cleartext in 4 nested encodings: b64(reverse(rot13(b64(payload)))).
// Player must reverse each step to recover the inner string.
export function wrapMatryoshka(payload: string): string {
  return b64encode(reverseString(rot13(b64encode(payload))));
}

const html = (blob: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>oracle — matryoshka</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.6;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  .blob{
    display:block;margin:1.4rem 0;padding:1rem 1.2rem;
    background:#001;border:1px solid #033;color:#9f9;
    word-wrap:break-word;word-break:break-all;
    font-size:.95rem;letter-spacing:.02em;
  }
  .nb{color:#9cf;}
  .dim{color:#586;}
</style></head><body>
<h1>oracle: matryoshka</h1>
<pre>
  > the oracle hands you a doll.
  > there is a doll inside the doll.
  > four veils, four turns.
  > the inside has two things you need.
</pre>
<code class="blob">${blob}</code>
<pre class="dim">
  > submit the flag once you have unwrapped it.
  > the second line is yours to keep — gibson will ask for it later.
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the oracle is wearing layers. nothing inside the page reads as plain english.',
    hint2: 'this looks like base64 — but the result of one decode still looks encoded.',
    hint3: "between two base64 hops there's a classical cipher and a string trick.",
    hint4: 'decode order, outside in: base64 → reverse the string → rot13 → base64.',
    hint5: 'paste the blob into CyberChef and apply From Base64 → Reverse → ROT13 → From Base64; the second line of the result is your gibson key fragment.',
  },

  async page(_req, reply, { flag }) {
    const payload = `flag=${flag}\ngibson_key_part_1=${GIBSON_KEY_PARTS[1]}`;
    const blob = wrapMatryoshka(payload);
    reply.type('text/html').send(html(blob));
  },
};
