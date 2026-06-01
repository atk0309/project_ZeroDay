// Challenge 18 — Ghost in the shell. OSINT. mitnick.example.com.
//
// Mechanic: a Mitnick-flavored social-engineering pivot. The landing page
// names what to find without naming where ("there's a name we don't want
// anyone saying. say it."). The breadcrumb is a robots.txt Disallow that
// points the player at /staff — a fake operative roster. Eight decoy rows
// are identical for every player; one ninth row is the *current* player's
// personal target. Visible row text on every row reads [REDACTED]; the
// player's row leaks via the avatar img alt attribute (view-source OSINT).
//
// Per-player secret: each player gets a unique deterministic <handle>-<NNNN>
// derived in lib/ghostShell.ts. The secret is intentionally short for puzzle
// usability (640k-value space) — that low entropy means it cannot double as
// authoritative anti-cheat evidence, so this handler does NOT trigger
// recordCheatDetection on shaped misses. Doing so from an idempotent GET
// would also let a top-level navigation (CSRF) frame any player at #18.
// Real flag-sharing detection is the canonical-flag path in lib/cheatDetect.ts.
//
// Single GET, no server state in the handler. State lives in the URL
// (?find=) and the per-user salt.

import type { ChallengeModule } from '../types.js';
import { secretForUser, DECOY_ROSTER } from '../../lib/ghostShell.js';
import type { User } from '../../lib/playerAuth.js';

export type SubmitResult =
  | { kind: 'idle' }
  | { kind: 'wrong'; got: string }
  | { kind: 'ok' };

// Pure-function evaluator. No DB side effects.
export function evaluateSubmit(user: Pick<User, 'flag_salt'>, input: string | null): SubmitResult {
  if (input === null || input.trim().length === 0) return { kind: 'idle' };
  const submitted = input.trim().toLowerCase();
  if (submitted === secretForUser(user)) return { kind: 'ok' };
  return { kind: 'wrong', got: input };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

const SHARED_HEAD = `<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  a{color:#9cf;}
  .panel{margin:1rem 0;padding:.7rem 1rem;background:#001;border-left:2px solid #066;color:#7aa;}
  form{margin:1.2rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:24rem;letter-spacing:.06em;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.45rem 1.1rem;font-family:inherit;cursor:pointer;}
  .nb{color:#9cf;}
  .dim{color:#586;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .alert{color:#fc6;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
  table.roster{width:100%;border-collapse:collapse;margin:1.2rem 0;background:#001;}
  table.roster th,table.roster td{padding:.5rem .8rem;border-bottom:1px solid #033;text-align:left;font-weight:normal;}
  table.roster th{color:#9cf;letter-spacing:.06em;}
  table.roster img{width:18px;height:18px;vertical-align:middle;background:#022;border:1px solid #066;}
  .redacted{color:#586;letter-spacing:.1em;}
</style>`;

// 1×1 transparent gif — the puzzle is the alt attribute, not the pixel.
const PIXEL_GIF = '/c/18/avatar.gif';

function submitForm(): string {
  return `<form method="get">
  <input type="text" name="find" placeholder="paste the name here" autofocus autocomplete="off" spellcheck="false">
  <button type="submit">submit</button>
</form>`;
}

function resultPanel(result: SubmitResult, flag: string): string {
  switch (result.kind) {
    case 'idle':
      return '<pre class="dim">; awaiting submission.</pre>';
    case 'wrong':
      return `<pre class="bad">; not the name. "${escapeHtml(result.got)}" doesn't match the file.</pre>`;
    case 'ok':
      return `<pre class="ok">
  > kevin nods. you read the room.
  > the name was already in the building.

  <span class="flag">${flag}</span>
</pre>`;
  }
}

function landingPage(result: SubmitResult, flag: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>mitnick — the social layer</title>
${SHARED_HEAD}
</head><body>
<h1>mitnick.example.com — the social layer</h1>
<pre>
  > kevin's voice, low and patient:
  > "they always think the wall is the firewall. it isn't.
  >  the wall is whoever picks up the phone."
  >
  > there's a name we don't want anyone saying today.
  > a real one, on the inside. find it. say it.
</pre>
<div class="panel">
  > technique:
  >   the front door doesn't list employees.
  >   well-behaved servers tell crawlers what they're hiding.
  >   look in the margins. read the source. the answer is on the page.
</div>
${submitForm()}
${resultPanel(result, flag)}
</body></html>`;
}

function staffPage(user: Pick<User, 'flag_salt'>, result: SubmitResult, flag: string): string {
  const personalSecret = secretForUser(user);
  const personalSuffix = personalSecret.split('-')[1] ?? '';

  // Decoys all carry the same alt="[REDACTED]" — only the player's row
  // leaks. data-emp-id on the decoys is a stable hash-like number; on the
  // player's row it's the secret's numeric suffix. Decoy IDs use the same
  // 6-digit width as the personal row so visual width alone doesn't tell
  // the player which row is theirs.
  const decoyRows: string[] = DECOY_ROSTER.map((d, i) => {
    const decoyId = String(200000 + i * 13219).padStart(6, '0');
    return `  <tr>
    <td><img src="${PIXEL_GIF}" alt="[REDACTED]" data-emp-id="${decoyId}"></td>
    <td><span class="redacted">[REDACTED]</span></td>
    <td>${escapeHtml(d.role)}</td>
    <td class="dim">${escapeHtml(d.era)}</td>
  </tr>`;
  });

  // Personal row mixes into the decoy list (slot index = suffix mod 9)
  // so a roster-diff between two players doesn't trivially identify "the
  // odd row" by position alone. The leak is in the alt attribute, not in
  // row order — but mixing positions adds a small layer of friction.
  const personalRow = `  <tr>
    <td><img src="${PIXEL_GIF}" alt="${escapeHtml(personalSecret)}" data-emp-id="${escapeHtml(personalSuffix)}"></td>
    <td><span class="redacted">[REDACTED]</span></td>
    <td>field operative</td>
    <td class="dim">90-94</td>
  </tr>`;

  const slotIdx = parseInt(personalSuffix, 10) % (decoyRows.length + 1);
  const rows = decoyRows.slice();
  rows.splice(slotIdx, 0, personalRow);
  const allRows = rows.join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>mitnick — staff directory (internal)</title>
${SHARED_HEAD}
</head><body>
<h1>mitnick.example.com :: staff directory</h1>
<pre>
  > internal. not crawled. not indexed.
  > names suppressed pending review.
  > avatars on file. roles on file. names redacted.
</pre>
<table class="roster">
  <tr><th>id</th><th>handle</th><th>role</th><th>era</th></tr>
${allRows}
</table>
<div class="panel">
  > the redaction is at the render layer.
  > the source layer is honest.
</div>
${submitForm()}
${resultPanel(result, flag)}
</body></html>`;
}

function notFoundPage(path: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>404 — mitnick</title>
${SHARED_HEAD}
</head><body>
<h1>404</h1>
<pre>
  > path: ${escapeHtml(path)}
  > kevin doesn't keep this room.
  > try the front door. or read what the robots are told to skip.
</pre>
</body></html>`;
}

const ROBOTS_TXT = `User-agent: *
Disallow: /staff
`;

function isLandingPath(path: string): boolean {
  // '/' covers subdomain dispatch (mitnick.example.com/); '/c/18' covers the
  // hub canonical URL (no wildcard subpath rewrite happens for the bare
  // /c/18 entry — see routes/hub.ts:dispatchChallenge).
  return path === '/' || path === '/c/18';
}

export const handler: ChallengeModule = {
  hints: {
    hint1: "there's a name we don't want spoken. find it.",
    hint2: "the front door doesn't list employees. servers usually do, badly.",
    hint3: "robots are honest about what they're told to hide.",
    hint4: "the staff page redacts every name. but redaction is a render trick, not a source trick.",
    hint5: 'view-source on /staff. one row\'s avatar has an alt attribute that isn\'t [redacted]. submit that handle via ?find=<handle>-<nnnnnn>.',
  },

  async page(req, reply, { user, flag }) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path === '/robots.txt') {
      reply.type('text/plain').send(ROBOTS_TXT);
      return;
    }

    // Decorative avatar pixel, served from any of the candidate paths the
    // page might link to. Doesn't carry any leak — the leak is the alt
    // attribute on the page, not the bytes of the image.
    if (path === '/avatar.gif' || path === '/c/18/avatar.gif' || path === '/staff/avatar.gif') {
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      reply.type('image/gif').send(pixel);
      return;
    }

    const isStaff = path === '/staff';
    const isLanding = isLandingPath(path);
    if (!isStaff && !isLanding) {
      reply.code(404).type('text/html').send(notFoundPage(path));
      return;
    }

    // Read query via Fastify's parsed `req.query`, not via `new URL(req.url, ...)`,
    // because routes/hub.ts:dispatchChallenge rewrites `req.raw.url` to the
    // puzzle-relative path and that rewrite drops the query string. Fastify
    // parses `req.query` before the rewrite, so it still has `?find=…`.
    const query = (req.query ?? {}) as Record<string, string | string[] | undefined>;
    const findRaw = query.find;
    const find = typeof findRaw === 'string' ? findRaw : Array.isArray(findRaw) ? (findRaw[0] ?? null) : null;
    const result: SubmitResult = evaluateSubmit(user, find);

    const body = isStaff ? staffPage(user, result, flag) : landingPage(result, flag);
    reply.type('text/html').send(body);
  },
};
