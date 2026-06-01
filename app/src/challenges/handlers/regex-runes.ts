// Challenge 11 — Regex runes. Logic. oracle.example.com.
//
// Mechanic: the oracle keeps two columns of "runes" — BLESSED (must match) and
// CURSED (must not match). Player submits a regex via ?pattern=. Server
// compiles it (try/catch, length-capped) and tests every rune. Iff every
// blessed rune matches AND no cursed rune matches, the oracle reveals the flag.
//
// The intended separator: `^[A-F]{4}$` — exactly four hex letters with no
// digits. Literal alternation (`^(CAFE|DEAD|...)$`) is also accepted as a
// valid solution; the puzzle is about reading the data, not about elegance.
import type { ChallengeModule } from '../types.js';

const BLESSED = ['CAFE', 'DEAD', 'BEEF', 'FACE', 'CEDE', 'FADE'];
const CURSED  = ['C0DE', '1337', 'ABBAB', 'C1A0', 'DECAF', 'CFCFCF'];

const MAX_PATTERN_LENGTH = 96;

export interface RegexRunesResult {
  ok: boolean;
  reason?: 'empty' | 'too_long' | 'invalid_regex' | 'missed_blessed' | 'matched_cursed';
  missed?: string[];
  matchedCursed?: string[];
}

// Reject patterns whose quantifiers could blow up the regex engine. Some short
// patterns like `^(A?){1000000000}$` compile fine but throw RangeError or
// burn CPU during .test(), blocking the event loop. The intended solution
// `^[A-F]{4}$` is well under this cap, so honest play is unaffected.
const MAX_QUANTIFIER_REPEAT = 256;

function hasOversizedQuantifier(src: string): boolean {
  // Match all three counted-quantifier forms: `{n}`, `{n,m}`, and `{n,}`
  // (open-ended). The earlier version omitted `{n,}`, so a pattern like
  // `^(A?){1000000000,}$` slipped past the preflight check and stalled the
  // event loop inside `re.test()`. Reject when either bound exceeds the cap.
  const re = /\{(\d+)(?:,\s*(\d+)?)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lo = Number.parseInt(m[1], 10);
    if (lo > MAX_QUANTIFIER_REPEAT) return true;
    if (m[2] !== undefined) {
      const hi = Number.parseInt(m[2], 10);
      if (hi > MAX_QUANTIFIER_REPEAT) return true;
    }
  }
  return false;
}

// Wrap .test() so a runtime throw (e.g. stack overflow on pathological
// backtracking) becomes a clean rejection instead of a 500 / event-loop stall.
function safeTest(re: RegExp, s: string): { ok: boolean; threw: boolean } {
  try {
    return { ok: re.test(s), threw: false };
  } catch {
    return { ok: false, threw: true };
  }
}

export function evaluatePattern(pattern: string): RegexRunesResult {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_PATTERN_LENGTH) return { ok: false, reason: 'too_long' };
  if (hasOversizedQuantifier(trimmed)) return { ok: false, reason: 'invalid_regex' };

  let re: RegExp;
  try {
    re = new RegExp(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_regex' };
  }

  const missed: string[] = [];
  for (const s of BLESSED) {
    const r = safeTest(re, s);
    if (r.threw) return { ok: false, reason: 'invalid_regex' };
    if (!r.ok) missed.push(s);
  }
  if (missed.length > 0) return { ok: false, reason: 'missed_blessed', missed };

  const matchedCursed: string[] = [];
  for (const s of CURSED) {
    const r = safeTest(re, s);
    if (r.threw) return { ok: false, reason: 'invalid_regex' };
    if (r.ok) matchedCursed.push(s);
  }
  if (matchedCursed.length > 0) return { ok: false, reason: 'matched_cursed', matchedCursed };

  return { ok: true };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

function column(label: string, items: string[], color: string): string {
  return `<div class="col">
  <div class="head" style="color:${color}">${label}</div>
  <ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
</div>`;
}

function reasonText(r: RegexRunesResult): string {
  switch (r.reason) {
    case 'empty':         return 'the oracle awaits a pattern. silence is no answer.';
    case 'too_long':      return `the oracle does not entertain incantations longer than ${MAX_PATTERN_LENGTH} runes.`;
    case 'invalid_regex': return 'the runes did not compile. the oracle frowns.';
    case 'missed_blessed':
      return `the blessed reject your pattern: ${(r.missed ?? []).join(', ')}.`;
    case 'matched_cursed':
      return `the cursed creep through your pattern: ${(r.matchedCursed ?? []).join(', ')}.`;
    default: return '';
  }
}

const html = (pattern: string, result: RegexRunesResult | null, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>oracle — regex runes</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .grid{display:flex;gap:3rem;margin:1.4rem 0 .4rem;}
  .col{min-width:14rem;}
  .head{font-size:.85rem;letter-spacing:.16em;text-transform:uppercase;margin-bottom:.4rem;}
  ul{list-style:none;padding:0;margin:0;}
  li{font-size:1.05rem;letter-spacing:.04em;padding:.15rem 0;}
  form{margin:1.4rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:32rem;max-width:60vw;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.45rem 1.1rem;font-family:inherit;cursor:pointer;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .dim{color:#586;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
</style></head><body>
<h1>oracle: regex runes</h1>
<pre>
  > the oracle has split the runes into two heaps.
  > tell it the pattern that <span class="ok">blesses</span> the first
  > and <span class="bad">curses</span> the second.
  > the oracle will not entertain trivialities.
</pre>
<div class="grid">
  ${column('BLESSED — must match', BLESSED, '#9f9')}
  ${column('CURSED — must not match', CURSED, '#f77')}
</div>
<form method="get">
  <input type="text" name="pattern" placeholder="^...$" value="${escapeHtml(pattern)}" autofocus>
  <button type="submit">offer pattern</button>
</form>
${result === null ? '<pre class="dim">; awaiting pattern.</pre>'
  : result.ok
    ? `<pre class="ok">; the oracle concedes.\n  ${flag === null ? '' : `<span class="flag">${flag}</span>`}\n</pre>`
    : `<pre class="bad">; ${escapeHtml(reasonText(result))}</pre>`}
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the oracle separates twins from imposters. find what makes the twins twins.',
    hint2: 'compare the columns side-by-side. count the characters. read the alphabet.',
    hint3: 'the blessed share two properties. each cursed rune breaks at least one.',
    hint4: 'the blessed are exactly four characters long and contain only the letters A through F.',
    hint5: 'submit ^[A-F]{4}$  —  start, four hex letters, end.',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const pattern = url.searchParams.get('pattern') ?? '';
    const result = pattern.length === 0 ? null : evaluatePattern(pattern);
    reply.type('text/html').send(html(pattern, result, result?.ok ? flag : null));
  },
};
