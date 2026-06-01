// Challenge 15 — Crack the WOPR. Crypto. wopr.example.com.
//
// Mechanic: the auth prompt publishes a sha-256 digest. The hash is the
// canonical sha256("joshua") — joshua being falken's son, the wopr's
// backdoor password from wargames (1983). The page ships a small wordlist
// hint pointing at the falken family register; the player either cracks the
// digest with hashcat -m 1400 or guesses from the lore. ?login=joshua reveals
// the per-player flag.
//
// The hash is canonical (not per-player-salted) — the puzzle is "crack one
// hash" with one famous answer. Per-player isolation lives in the rendered
// flag, not in the hash. Single GET, no server state.
import { createHash } from 'node:crypto';
import type { ChallengeModule } from '../types.js';

// SECURITY-SCANNER NOTE (CodeQL js/insufficient-password-hash):
// This is NOT a credential store, so the "insufficient computational effort"
// finding is a false positive *in risk* even though it is a true positive *in
// shape*. `crack-wopr` is challenge #15 — a CTF crypto puzzle whose entire
// mechanic is "here is an unsalted SHA-256 digest, crack it". The word below
// is 'joshua', the public WarGames (1983) backdoor password: hardcoded film
// lore, not a secret, and the digest is deliberately PUBLISHED in the rendered
// page for the player to attack with `hashcat -m 1400`. There is no protected
// password and no user account behind this hash — per-player isolation lives
// in the rendered flag (see the header comment), never in the digest. Swapping
// in a slow/salted KDF (bcrypt/scrypt/argon2) would defeat the puzzle by
// design. The identifiers are named for what they are (lore, not a password)
// and the sink carries an inline suppression so the alert stays closed without
// us pretending this is a credential path.
const WOPR_LORE_WORD = 'joshua';

export const WOPR_LORE_DIGEST =
  createHash('sha256').update(WOPR_LORE_WORD, 'utf8').digest('hex'); // codeql[js/insufficient-password-hash] -- intentional, published CTF digest; not a credential (see note above)

export type LoginResult =
  | { kind: 'idle' }
  | { kind: 'wrong'; got: string }
  | { kind: 'ok' };

export function verifyPassword(input: string | null): LoginResult {
  if (input === null || input.length === 0) return { kind: 'idle' };
  if (input === WOPR_LORE_WORD) return { kind: 'ok' };
  return { kind: 'wrong', got: input };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

const html = (result: LoginResult, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>wopr — login</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .digest{display:block;margin:1rem 0;padding:.8rem 1rem;background:#001;border:1px solid #033;color:#9f9;word-break:break-all;letter-spacing:.04em;font-size:.95rem;}
  .register{margin:1rem 0;padding:.7rem 1rem;background:#001;border-left:2px solid #066;color:#7aa;}
  form{margin:1.2rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.45rem .7rem;font-family:inherit;width:18rem;letter-spacing:.06em;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.45rem 1.1rem;font-family:inherit;cursor:pointer;}
  .nb{color:#9cf;}
  .dim{color:#586;}
  .ok{color:#9f9;}
  .bad{color:#f77;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
</style></head><body>
<h1>wopr.example.com — login</h1>
<pre>
  > identify.
  > the wopr trusts a single name. one word. submit it.
</pre>
<pre class="dim">  shadow record (sha-256, no salt):</pre>
<code class="digest">${WOPR_LORE_DIGEST}</code>
<div class="register">
  > the system reads from the falken family register.
  > spouse. son. dog. maze. the names are short. the names are old.
</div>
<form method="get">
  <input type="text" name="login" placeholder="name" autofocus autocomplete="off">
  <button type="submit">login</button>
</form>
${(() => {
  switch (result.kind) {
    case 'idle':
      return '<pre class="dim">; awaiting credential.</pre>';
    case 'wrong':
      return `<pre class="bad">; identification failed. ${escapeHtml(result.got)} is not on file.</pre>`;
    case 'ok':
      return `<pre class="ok">
  > GREETINGS, PROFESSOR FALKEN.
  > shall we play a game?

  <span class="flag">${flag}</span>
</pre>`;
  }
})()}
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the system trusts a name. one name.',
    hint2: 'you have a digest and a wordlist hint. that is everything a cracker needs.',
    hint3: 'wargames (1983). the password belongs to falken — and to someone he lost.',
    hint4: 'sha-256, no salt. small wordlist drawn from the film. hashcat -m 1400.',
    hint5: 'the password is joshua. submit ?login=joshua.',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const input = url.searchParams.get('login');
    const result = verifyPassword(input);
    reply.type('text/html').send(html(result, result.kind === 'ok' ? flag : null));
  },
};
