// Challenge 16 — Git archaeology. Logic. hack.example.com.
//
// Mechanic: a leak in plain sight. an internal repo got pushed public; an
// engineer "fixed" the embedded credential in a follow-up commit but never
// `git push --force`d. the planted blob is still reachable through history.
// player runs `git log -p -- deploy.sh` (or similar archaeology), pulls the
// canonical secret out of the diff, submits via ?secret=<value>.
//
// the canonical secret is one shared answer; per-player isolation lives in
// the rendered flag, not in the puzzle. single GET, no server state.
//
// **why a digest, not the plaintext.** crack-wopr ships its plaintext
// (`'joshua'`) intentionally — the puzzle there is "crack the published
// digest". here the puzzle is "find the secret in old commits", so embedding
// the plaintext in the open-source handler would skip the puzzle entirely.
// we ship only sha-256(secret) and compare timing-safely. the seed-repo
// helper lives at tools/git-seed.sh.
//
// **rotating for your own deployment.** pick any string, plant it in your
// fork of the seed repo via `ZERODAY_SEED_SECRET=<your-string> tools/git-seed.sh`,
// then either (a) replace SECRET_DIGEST below with the sha-256 hex of your
// string, or (b) set GIT_ARCHAEOLOGY_SECRET_DIGEST in the runtime env to that
// hex. the env override always wins over the baked-in default.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ChallengeModule } from '../types.js';

// the public seed repo. landing page links here. operators forking the game
// for a real run swap this to their own seed repo.
export const REPO_URL = 'https://github.com/atk0309/ZeroDay-internal';

// Default sha-256 of the canonical secret planted by tools/git-seed.sh. The
// plaintext is intentionally NOT documented here — players are meant to
// recover it from the public seed repo's git history. Operators forking the
// game pick their own secret and either rebake this constant or set
// GIT_ARCHAEOLOGY_SECRET_DIGEST.
const DEFAULT_SECRET_DIGEST_HEX =
  'e7c0dd43059b3a04e6f96d8e74979ecb79896587e0a68496e5343dfada9dd9f5';

function activeSecretDigest(): Buffer {
  const envHex = process.env.GIT_ARCHAEOLOGY_SECRET_DIGEST;
  if (typeof envHex === 'string' && /^[0-9a-fA-F]{64}$/.test(envHex)) {
    return Buffer.from(envHex, 'hex');
  }
  return Buffer.from(DEFAULT_SECRET_DIGEST_HEX, 'hex');
}

export type SubmitResult =
  | { kind: 'idle' }
  | { kind: 'wrong'; got: string }
  | { kind: 'ok' };

export function verifySecret(input: string | null): SubmitResult {
  if (input === null || input.length === 0) return { kind: 'idle' };
  const digest = createHash('sha256').update(input, 'utf8').digest();
  // both buffers are 32 bytes by construction (sha-256 output + the literal
  // hex constant above), so timingSafeEqual's length precondition holds.
  if (timingSafeEqual(digest, activeSecretDigest())) return { kind: 'ok' };
  return { kind: 'wrong', got: input };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

const html = (result: SubmitResult, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>hack — leak triage</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  a{color:#9cf;}
  .repo{display:block;margin:1rem 0;padding:.8rem 1rem;background:#001;border:1px solid #033;color:#9f9;word-break:break-all;letter-spacing:.04em;font-size:.95rem;}
  .panel{margin:1rem 0;padding:.7rem 1rem;background:#001;border-left:2px solid #066;color:#7aa;}
  form{margin:1.2rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:32rem;letter-spacing:.06em;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.45rem 1.1rem;font-family:inherit;cursor:pointer;}
  .nb{color:#9cf;}
  .dim{color:#586;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
</style></head><body>
<h1>hack.example.com — leak triage</h1>
<pre>
  > one of theirs got pushed public. the secret was "fixed" in a follow-up
  > commit. nobody force-pushed. the blob's still in there if you know how
  > to ask.
  > recover the line. submit it back.
</pre>
<a class="repo" href="${escapeHtml(REPO_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(REPO_URL)}</a>
<div class="panel">
  > tooling cheat-sheet:
  >   git clone ${escapeHtml(REPO_URL)}
  >   git log --oneline
  >   git log -p -- &lt;path&gt;
  >   git show &lt;sha&gt;
</div>
<form method="get">
  <input type="text" name="secret" placeholder="paste the recovered line here" autofocus autocomplete="off" spellcheck="false">
  <button type="submit">submit</button>
</form>
${(() => {
  switch (result.kind) {
    case 'idle':
      return '<pre class="dim">; awaiting submission.</pre>';
    case 'wrong':
      return `<pre class="bad">; not in the record. "${escapeHtml(result.got)}" doesn't match the planted line.</pre>`;
    case 'ok':
      return `<pre class="ok">
  > trace confirmed. you read history like a ghost.
  > the operator nods. you're a real one.

  <span class="flag">${flag}</span>
</pre>`;
  }
})()}
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'what gets pushed public can\'t be unpushed.',
    hint2: 'old commits don\'t disappear when you "fix" them. they just get quieter.',
    hint3: 'git log -p reads every diff. git log -p -- <path> reads every diff to one file.',
    hint4: 'the deploy script lost a line. a line worth keeping.',
    hint5: 'middle commit on main, deploy.sh diff. the line starts with zeroday_deploy_key.',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const input = url.searchParams.get('secret');
    const result = verifySecret(input);
    reply.type('text/html').send(html(result, result.kind === 'ok' ? flag : null));
  },
};
