// Challenge 12 — XOR with the oracle. Crypto. oracle.example.com.
//
// Mechanic: the oracle encrypts a known-format payload with a short repeating
// key and serves the ciphertext as hex. The payload always starts with the
// literal `flag=ZERODAY{` (13 chars). The key is 11 bytes: `wargames-83`.
// Since the known prefix is longer than the key, the player can recover the
// full key by XORing ciphertext[0..12] with the known prefix, then decrypt
// the rest of the blob to read the flag.
//
// Pure offline crypto — no interactivity. The page just exposes the blob and
// the constraint (every transmission begins with `flag=...`).
import type { ChallengeModule } from '../types.js';

const KEY = 'wargames-83'; // 11 bytes — shorter than the 13-char known prefix
const SUFFIX = 'sigil=THE-ONLY-WINNING-MOVE';

export function xorRepeating(plaintext: Buffer, key: string): Buffer {
  const k = Buffer.from(key, 'utf8');
  const out = Buffer.alloc(plaintext.length);
  for (let i = 0; i < plaintext.length; i++) {
    out[i] = plaintext[i]! ^ k[i % k.length]!;
  }
  return out;
}

export function buildBlobHex(flag: string): string {
  const plaintext = Buffer.from(`flag=${flag}\n${SUFFIX}`, 'utf8');
  return xorRepeating(plaintext, KEY).toString('hex').toUpperCase();
}

const html = (blobHex: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>oracle — xor</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.6;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .blob{
    display:block;margin:1.4rem 0;padding:1rem 1.2rem;
    background:#001;border:1px solid #033;color:#9f9;
    word-wrap:break-word;word-break:break-all;
    font-size:.95rem;letter-spacing:.04em;
  }
  .nb{color:#9cf;}
  .dim{color:#586;}
</style></head><body>
<h1>oracle: xor</h1>
<pre>
  > the oracle whispers in xor. the key is short and the same all the way through.
  > <span class="nb">every transmission begins the same way:</span> flag=ZERODAY{...}
  > the oracle's key is shorter than that beginning.
  > beneath the flag there is a sigil. you do not need it. you may keep it.
</pre>
<code class="blob">${blobHex}</code>
<pre class="dim">
  > submit the flag once you have it.
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the oracle whispers in noise. the same noise, on a loop.',
    hint2: 'every message starts with the same eleven characters of plaintext you can name.',
    hint3: 'XOR is its own inverse. ciphertext XOR plaintext is the key — for the bytes you know.',
    hint4: 'the prefix flag=ZERODAY{ is 13 chars. the key is shorter than 13. recover it from the head, then sweep the rest.',
    hint5: "hex-decode the blob. XOR the first 13 bytes against ASCII 'flag=ZERODAY{' to read the repeating key. XOR the whole blob against that key. read line one.",
  },

  async page(_req, reply, { flag }) {
    const blob = buildBlobHex(flag);
    reply.type('text/html').send(html(blob));
  },
};
