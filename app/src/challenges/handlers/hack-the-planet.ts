// Challenge 19 — Hack the planet. Final. gibson.example.com.
//
// The finale. Player has collected three GIBSON key fragments along the way:
// fragment 1 from #7 matryoshka, fragment 2 from #13 ports-of-call, fragment 3
// from #17 stego-static. Each is 16 hex chars (8 bytes). Concatenated they
// form a 24-byte AES-192 key. The page renders a per-player AES-192-CBC
// ciphertext + IV; submitting the three fragments via ?k1=&k2=&k3= unlocks
// the decrypt and reveals the per-player flag in the diegetic plaintext.
//
// Why server-side decrypt: the canonical key is already on the server (it's
// the GIBSON_KEY_PARTS table), and the per-player flag has to be HMAC-derived
// from user.flag_salt anyway. Doing the decrypt server-side lets the failure
// mode be "key fragment N rejected" — far better than "decryption failed:
// garbled bytes". The cryptography is real (AES-192-CBC with the concatenated
// hex as the raw key, IV derived per-user from flag_salt); we're just running
// the cipher on the player's behalf so they can submit fragments and read
// CRT-styled prose instead of bytes.
//
// Frozen-phase short-circuit lives upstream: routes/hub.ts routes ordinal-19
// to the lights-out focus lobby (hub.ejs) once end_at is past, and server.ts
// redirects subdomain hits to / when phase != 'live'. This handler is never
// called in those branches.

import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import type { ChallengeModule } from '../types.js';
import type { User } from '../../lib/playerAuth.js';
import { GIBSON_KEY_PARTS, type GibsonKeyPart } from '../../lib/gibson.js';

// 24 bytes = AES-192. Built lazily so a startup with placeholder fragments
// (during partial authoring) doesn't crash the import — Buffer.from(invalid
// hex) silently truncates, which would be worse to debug than a runtime throw
// on actual use.
export function gibsonAesKey(): Buffer {
  const hex = GIBSON_KEY_PARTS[1] + GIBSON_KEY_PARTS[2] + GIBSON_KEY_PARTS[3];
  if (!/^[0-9A-Fa-f]{48}$/.test(hex)) {
    throw new Error('gibson key parts not all wired (expected 48 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

// Per-user IV, deterministic. flag_salt is already user-unique and never
// reused; HMAC'ing a fixed label off it gives a stable 16 bytes for CBC
// without storing any extra state. The same user always gets the same
// ciphertext for the same flag, which lets the page be cache-friendly and
// idempotent on reload.
export function gibsonIv(user: Pick<User, 'flag_salt'>): Buffer {
  return createHmac('sha256', user.flag_salt).update('gibson-iv').digest().subarray(0, 16);
}

// Diegetic plaintext. flag already wraps in ZERODAY{...}.
export function plaintextFor(user: Pick<User, 'alias'>, flag: string): string {
  return `welcome to the collective, ${user.alias}.\n${flag}\nthe only way to fight a bad guy with a computer is to be a good guy with a computer.\n`;
}

export function encryptForUser(user: Pick<User, 'alias' | 'flag_salt'>, flag: string): Buffer {
  const cipher = createCipheriv('aes-192-cbc', gibsonAesKey(), gibsonIv(user));
  return Buffer.concat([cipher.update(plaintextFor(user, flag), 'utf8'), cipher.final()]);
}

function normalizeHex(s: string): string {
  return s.trim().replace(/\s+/g, '').toUpperCase();
}

export interface FragmentValidation {
  kind: 'ok' | 'wrong';
  wrongFragments: GibsonKeyPart[];
}

// Per-fragment exact compare (case-insensitive, whitespace-tolerant). A wrong
// fragment is any of: empty, malformed hex, or correct shape but wrong bytes —
// we don't care which; the puzzle is "paste the right strings".
export function validateFragments(k1: string, k2: string, k3: string): FragmentValidation {
  const wrong: GibsonKeyPart[] = [];
  const submitted: Record<GibsonKeyPart, string> = { 1: k1, 2: k2, 3: k3 };
  for (const n of [1, 2, 3] as GibsonKeyPart[]) {
    if (normalizeHex(submitted[n]) !== GIBSON_KEY_PARTS[n].toUpperCase()) wrong.push(n);
  }
  return { kind: wrong.length === 0 ? 'ok' : 'wrong', wrongFragments: wrong };
}

// Pure-function entry point exercised by tests. Returns the plaintext on full
// validation pass, null on any wrong fragment or decrypt failure.
export function decryptForUser(
  user: Pick<User, 'flag_salt'>,
  ciphertext: Buffer,
  iv: Buffer,
  k1: string,
  k2: string,
  k3: string,
): string | null {
  if (validateFragments(k1, k2, k3).kind !== 'ok') return null;
  try {
    const decipher = createDecipheriv('aes-192-cbc', gibsonAesKey(), iv);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

interface LandingArgs {
  alias: string;
  ciphertextHex: string;
  ivHex: string;
  k1: string;
  k2: string;
  k3: string;
  wrongFragments: GibsonKeyPart[]; // empty = idle
}

const css = `
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;max-width:880px;margin:0 auto;}
  h1{font-weight:normal;letter-spacing:.06em;color:#9cf;}
  h2{font-weight:normal;letter-spacing:.05em;color:#9cf;font-size:1.05rem;text-transform:uppercase;}
  pre{font-size:1rem;}
  .crt{margin:1.4rem 0;padding:1rem 1.2rem;background:#001;border:1px solid #033;}
  .ciphertext{color:#9f9;word-break:break-all;font-size:.92rem;letter-spacing:.02em;}
  .iv{color:#586;letter-spacing:.04em;}
  .meta{color:#586;font-size:.88rem;letter-spacing:.06em;text-transform:uppercase;}
  form{margin:1.4rem 0;}
  .row{margin:.6rem 0;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;}
  label{color:#9cf;letter-spacing:.06em;min-width:11rem;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:22rem;max-width:60vw;letter-spacing:.06em;}
  input[type=text].rejected{border-color:#f55;color:#fdd;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.5rem 1.4rem;font-family:inherit;cursor:pointer;letter-spacing:.06em;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .dim{color:#586;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
  .granted{color:#9f9;font-size:1.4rem;letter-spacing:.12em;}
`;

function fragmentInput(n: GibsonKeyPart, value: string, rejected: boolean): string {
  const cls = rejected ? ' class="rejected"' : '';
  return `<div class="row">
  <label for="k${n}">key fragment ${n}</label>
  <input type="text" id="k${n}" name="k${n}"${cls} value="${escapeHtml(value)}" placeholder="16 hex" autocomplete="off" spellcheck="false">
</div>`;
}

function landingHtml(a: LandingArgs): string {
  const rejectedLines = a.wrongFragments.length
    ? a.wrongFragments.map((n) => `; key fragment ${n} rejected.`).join('\n')
    : null;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>gibson — login console</title>
<style>${css}</style></head><body>
<h1>gibson.example.com — login console</h1>
<pre>
  > handshake complete. you reached the planet.
  > the gibson speaks in ciphertext. paste the three fragments.
  > AES-192-CBC. key = fragment 1 ‖ fragment 2 ‖ fragment 3, raw hex.
</pre>
<div class="crt">
  <div class="meta">ciphertext (hex)</div>
  <pre class="ciphertext">${a.ciphertextHex}</pre>
  <div class="meta">iv (hex)</div>
  <pre class="iv">${a.ivHex}</pre>
</div>
<form method="get">
  ${fragmentInput(1, a.k1, a.wrongFragments.includes(1))}
  ${fragmentInput(2, a.k2, a.wrongFragments.includes(2))}
  ${fragmentInput(3, a.k3, a.wrongFragments.includes(3))}
  <div class="row"><button type="submit">decrypt</button></div>
</form>
${rejectedLines !== null
    ? `<pre class="bad">${escapeHtml(rejectedLines)}</pre>`
    : '<pre class="dim">; awaiting all three fragments.</pre>'}
</body></html>`;
}

function successHtml(plaintext: string, ciphertextHex: string, ivHex: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>gibson — access granted</title>
<style>${css}</style></head><body>
<h1>gibson.example.com — login console</h1>
<pre class="granted">ACCESS GRANTED — WELCOME TO THE COLLECTIVE</pre>
<div class="crt">
  <pre class="ok">${escapeHtml(plaintext)}</pre>
</div>
<pre class="dim">
  > the gibson is open. submit the flag in the hub to close the loop.
  > hack the planet.
</pre>
<details>
  <summary class="dim">cipher parameters</summary>
  <div class="crt">
    <div class="meta">ciphertext (hex)</div>
    <pre class="ciphertext">${ciphertextHex}</pre>
    <div class="meta">iv (hex)</div>
    <pre class="iv">${ivHex}</pre>
  </div>
</details>
</body></html>`;
}

export const handler: ChallengeModule = {
  hints: {
    hint1: 'you already have the keys. they were given to you, three at a time.',
    hint2: 'matryoshka, the switchboard, the static. each surfaced a fragment. concatenate them.',
    hint3: 'the cipher is AES-192. the page tells you the IV.',
    hint4: 'paste each fragment, in order, into the three slots. fragment 1 from #7, fragment 2 from #13, fragment 3 from #17.',
    hint5: 'visit ?k1=<part1>&k2=<part2>&k3=<part3> with the three 16-hex values you collected from #7, #13, #17.',
  },

  async page(req, reply, { user, flag }) {
    const url = new URL(req.url, 'http://x');
    const k1 = url.searchParams.get('k1') ?? '';
    const k2 = url.searchParams.get('k2') ?? '';
    const k3 = url.searchParams.get('k3') ?? '';

    const iv = gibsonIv(user);
    const ciphertext = encryptForUser(user, flag);
    const ciphertextHex = ciphertext.toString('hex');
    const ivHex = iv.toString('hex');

    const allSubmitted = k1.trim() !== '' && k2.trim() !== '' && k3.trim() !== '';
    if (allSubmitted) {
      const plaintext = decryptForUser(user, ciphertext, iv, k1, k2, k3);
      if (plaintext !== null) {
        reply.type('text/html').send(successHtml(plaintext, ciphertextHex, ivHex));
        return;
      }
      const v = validateFragments(k1, k2, k3);
      reply.type('text/html').send(landingHtml({
        alias: user.alias,
        ciphertextHex,
        ivHex,
        k1: v.wrongFragments.includes(1) ? '' : k1,
        k2: v.wrongFragments.includes(2) ? '' : k2,
        k3: v.wrongFragments.includes(3) ? '' : k3,
        wrongFragments: v.wrongFragments,
      }));
      return;
    }
    reply.type('text/html').send(landingHtml({
      alias: user.alias,
      ciphertextHex,
      ivHex,
      k1, k2, k3,
      wrongFragments: [],
    }));
  },
};
