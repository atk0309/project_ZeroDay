// Challenge 10 — Method in the madness. Net. wopr.example.com.
//
// Mechanic: the puzzle is keyed off the HTTP verb, not the path. The landing
// (GET) is a WOPR terminal that hints "this terminal listens, but only to the
// right verb" and points at OPTIONS as the discovery channel.
//
// Method dispatch:
//   GET / HEAD       → landing page (no flag)
//   OPTIONS          → 204 + Allow: GET, OPTIONS, PATCH (the disclosure)
//   PATCH            → 200 + flag in body and X-Wopr-Patch response header
//   anything else    → 405 + Allow: GET, OPTIONS, PATCH
//
// The puzzle is reachable two ways:
//   - GET /c/10 from the hub → only ever serves the landing (route is GET-only).
//   - any verb to wopr.example.com / → host-dispatch hook in server.ts forwards
//     all methods to handler.page, so curl/Postman can probe the full matrix.
import type { ChallengeModule } from '../types.js';

const ALLOW = 'GET, HEAD, OPTIONS, PATCH';

const landing = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>wopr — console ii</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .nb{color:#9cf;}
  .dim{color:#586;}
  code{color:#fff;background:#011;padding:.1rem .35rem;}
</style></head><body>
<h1>wopr.example.com — console ii</h1>
<pre>
  > shall we play a game?
  > <span class="nb">no.</span> not yet.

  this terminal listens. it does not always speak.
  it speaks only when addressed in the proper verb.

  GET shows you this room.
  the room knows which verbs it will entertain.
  there is a polite way to ask.

  the right verb is the one you reach for when you intend
  to <span class="nb">change</span> something — not create, not erase. amend.

</pre>
<pre class="dim">
  $ curl -i -X &lt;verb&gt; https://wopr.example.com/
</pre>
</body></html>`;

const flagBody = (flag: string) => `accepted. patch applied.

${flag}
`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'GET is one of many verbs. the room cares which one you use.',
    hint2: 'before you guess a verb, ask the server which verbs it will accept.',
    hint3: 'OPTIONS is the discovery method. the response carries an Allow header.',
    hint4: 'the Allow header lists the verbs the room will entertain. one of them is the one you want — the verb that means "amend, do not replace".',
    hint5: 'curl -i -X PATCH https://wopr.example.com/  —  the flag is in the body and echoed in the X-Wopr-Patch response header.',
  },

  async page(req, reply, { flag }) {
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      reply.header('Allow', ALLOW);
      reply.code(204).send();
      return;
    }
    if (method === 'PATCH') {
      reply.header('X-Wopr-Patch', flag);
      reply.type('text/plain').send(flagBody(flag));
      return;
    }
    if (method === 'GET' || method === 'HEAD') {
      reply.type('text/html').send(landing);
      return;
    }
    reply.code(405).header('Allow', ALLOW).type('text/plain').send('method not allowed.\n');
  },
};
