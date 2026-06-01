// Challenge 4 — Zero Cool's cookie.
// First visit drops a base64'd JSON session cookie {user:'guest',admin:false}.
// The page renders "access denied" while admin=false. Player decodes the cookie,
// flips admin → true, re-encodes, reloads → ACCESS GRANTED + flag.
import type { ChallengeModule } from '../types.js';

const COOKIE_NAME = 'session';

function buildCookie(admin: boolean): string {
  return Buffer.from(JSON.stringify({ user: 'guest', admin })).toString('base64');
}

const html = (admin: boolean, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>zero cool — cinema</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.5;}
  pre{font-size:1.05rem;}
  .lock{color:#f55;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;}
  .key{color:#9cf;}
</style></head><body>
<pre>
  > zero cool's private cinema
  > authentication: cookie-based, vintage-1995

  current session:
    <span class="key">user</span>:  guest
    <span class="key">admin</span>: ${admin ? 'true' : 'false'}
${admin
  ? `\n  ACCESS GRANTED.\n  the projector hums to life.\n  <span class="flag">${flag}</span>\n`
  : `\n  <span class="lock">access denied.</span>\n  guests don't get to see the cinema. how dull.\n`}
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'access denied is rarely the end of the conversation.',
    hint2: 'sessions are stored somewhere. find what your browser is sending back.',
    hint3: 'cookies remember things. some cookies remember the wrong things.',
    hint4: 'the session cookie is base64-encoded JSON. decode it. read what it claims about you.',
    hint5: "flip 'admin':false to true, base64-encode the JSON again, paste it back, reload.",
  },

  async page(req, reply, { flag }) {
    const raw = req.cookies?.[COOKIE_NAME];
    let admin = false;

    if (raw) {
      try {
        const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        admin = decoded?.admin === true;
      } catch { /* malformed cookie → admin stays false */ }
    } else {
      reply.setCookie(COOKIE_NAME, buildCookie(false), {
        path: '/', httpOnly: false, sameSite: 'lax',
      });
    }

    reply.type('text/html').send(html(admin, admin ? flag : null));
  },
};
