// Challenge 5 — The headers don't lie.
// The server only releases the flag if the request's User-Agent contains
// "acid-burn" (case-insensitive). On a vanilla request, the response carries
// an X-Gibson-Hint header pointing the player at the User-Agent gate. On a
// matched request, the flag is set in the X-Gibson-Access response header AND
// embedded in the body.
import type { ChallengeModule } from '../types.js';

const PASSPHRASE = 'acid-burn';

const html = (granted: boolean, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>zero cool — clearance</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.5;}
  pre{font-size:1.05rem;}
  .lock{color:#f55;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;}
  .nb{color:#9cf;}
</style></head><body>
<pre>
  > zero cool's vestibule
  > i recognize voices, not faces.

${granted
  ? `  acid burn. of course.\n  the door swings open.\n\n  <span class="flag">${flag}</span>\n`
  : `  <span class="lock">i don't know you.</span>\n  acid burn was here before. she didn't have to ask.\n  <span class="nb">(maybe the gate is reading more than your URL.)</span>\n`}
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the door knows you. or rather, it knows your tools.',
    hint2: 'every request announces itself. some doors only open for the right announcement.',
    hint3: 'the server cares about more than what you GET. it cares who is asking.',
    hint4: 'User-Agent identifies your browser. some doors insist on a specific identity.',
    hint5: "send a request whose User-Agent contains 'acid-burn' (case-insensitive). curl -A works.",
  },

  async page(req, reply, { flag }) {
    const ua = String(req.headers['user-agent'] ?? '').toLowerCase();
    const granted = ua.includes(PASSPHRASE);

    if (granted) {
      reply.header('X-Gibson-Access', flag);
    } else {
      reply.header('X-Gibson-Hint', 'identity unverified - acid burn makes the cinema bow');
    }

    reply.type('text/html').send(html(granted, granted ? flag : null));
  },
};
