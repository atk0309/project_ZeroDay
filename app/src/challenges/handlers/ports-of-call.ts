// Challenge 13 — Ports of call. Net. wopr.example.com.
// Embeds GIBSON key part 2 of 3.
//
// Mechanic: WOPR-themed port-knocking analog. The landing page lists three
// "open lines" with cryptic labels. Player must dial them in the right
// sequence via ?dial=N1,N2,N3 (comma-separated). Single GET, no per-player
// server state — the order is encoded entirely in the query string.
//
// The canonical sequence: 2600 → 8128 → 31337.
//   - 2600   : Cap'n Crunch's whistle, the freq that birthed phreaking.
//   - 8128   : the fourth perfect number (1, 6, 28, 496, 8128).
//   - 31337  : "eleet" — leet to the elite.
//
// Out-of-order or partial dials return a "carrier dropped" notice. The
// in-order match returns flag + GIBSON key fragment 2 in the same response.
import type { ChallengeModule } from '../types.js';
import { renderKeyFragment } from '../../lib/gibson.js';

export const SEQUENCE = [2600, 8128, 31337] as const;

export type DialResult =
  | { kind: 'idle' }
  | { kind: 'malformed' }
  | { kind: 'wrong'; got: number[] }
  | { kind: 'ok' };

export function evaluateDial(raw: string | null): DialResult {
  if (raw === null || raw.trim().length === 0) return { kind: 'idle' };
  const parts = raw.split(',').map((s) => s.trim());
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { kind: 'malformed' };
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n)) return { kind: 'malformed' };
    nums.push(n);
  }
  if (nums.length !== SEQUENCE.length) return { kind: 'wrong', got: nums };
  for (let i = 0; i < SEQUENCE.length; i++) {
    if (nums[i] !== SEQUENCE[i]) return { kind: 'wrong', got: nums };
  }
  return { kind: 'ok' };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

const html = (raw: string, result: DialResult, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>wopr — switchboard</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .lines{margin:1.4rem 0;padding:1rem 1.2rem;background:#001;border:1px solid #033;}
  .line{padding:.3rem 0;}
  .label{color:#9cf;letter-spacing:.08em;}
  .clue{color:#586;}
  form{margin:1.2rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:24rem;max-width:60vw;letter-spacing:.06em;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.45rem 1.1rem;font-family:inherit;cursor:pointer;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .dim{color:#586;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
</style></head><body>
<h1>wopr.example.com — switchboard</h1>
<pre>
  > three lines are warm tonight. dial them in order.
  > the operator does not name them — only their stories.
  > one query, comma-separated. ?dial=A,B,C
</pre>
<div class="lines">
  <div class="line"><span class="label">line one  </span> <span class="clue">— the cereal box whistle. blue boxes were born from this frequency.</span></div>
  <div class="line"><span class="label">line two  </span> <span class="clue">— the fourth perfect number. take the one closest to ten thousand.</span></div>
  <div class="line"><span class="label">line three</span> <span class="clue">— if leet is 1337, this is leet to the elite. five digits.</span></div>
</div>
<form method="get">
  <input type="text" name="dial" placeholder="A,B,C" value="${escapeHtml(raw)}" autofocus>
  <button type="submit">dial</button>
</form>
${(() => {
  switch (result.kind) {
    case 'idle':
      return '<pre class="dim">; waiting for dial.</pre>';
    case 'malformed':
      return '<pre class="bad">; dial garbled. comma-separated digits only.</pre>';
    case 'wrong':
      return `<pre class="bad">; carrier dropped after ${escapeHtml(result.got.join(','))}. wrong number, wrong order, or both.</pre>`;
    case 'ok':
      return `<pre class="ok">; lines acquired in sequence. handshake complete.\n  <span class="flag">${flag}</span>\n</pre>${renderKeyFragment(2)}`;
  }
})()}
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'this is a switchboard, not a door. doors take one knock; switchboards take three, in order.',
    hint2: 'each line names itself only by a story. read each story, name the number.',
    hint3: 'first: phreaking lore — captain crunch and a toy whistle. second: a math curiosity older than computers. third: a hacker greeting in numerals.',
    hint4: 'first 2600. second 8128 (1+6+28+496+8128 — the perfects). third 31337 — "eleet".',
    hint5: 'visit /?dial=2600,8128,31337 on the wopr host (or /c/13?dial=2600,8128,31337 from the hub).',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const raw = url.searchParams.get('dial') ?? '';
    const result = evaluateDial(raw);
    reply.type('text/html').send(html(raw, result, result.kind === 'ok' ? flag : null));
  },
};
