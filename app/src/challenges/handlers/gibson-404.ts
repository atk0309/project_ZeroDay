// Challenge 8 — Gibson 404. Web. gibson.example.com.
//
// Mechanic: most paths return a styled 404. The 404 body has an HTML comment
// containing a base64'd hint pointing at /robots.txt. Robots lists two paths;
// one is a decoy that 404s, one is real and serves the flag (with a flag echo
// in the X-Gibson-Bypass response header).
import type { ChallengeModule } from '../types.js';

const HINT_404 = Buffer.from(JSON.stringify({ hint: 'check your robots.txt' })).toString('base64');

const notFoundPage = (path: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>404 — gibson</title>
<!-- ${HINT_404} -->
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.5;}
  h1{font-size:5rem;margin:0;color:#f55;letter-spacing:.06em;}
  .nb{color:#9cf;}
  .dim{color:#586;}
</style></head><body>
<h1>404</h1>
<pre>
  > path: ${path}
  > status: file not found, end of file reached, eot
  > the gibson does not know this room.
</pre>
<pre class="dim">
  > nothing here. probably.
</pre>
</body></html>`;

const probeDecoy = (path: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>404 — gibson</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.5;}
  h1{font-size:3rem;margin:0;color:#f55;}
</style></head><body>
<h1>404</h1>
<pre>
  > path: ${path}
  > nothing here. keep digging.
</pre>
</body></html>`;

const grantedPage = (flag: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>gibson — admin console</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.6;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;}
</style></head><body>
<h1>gibson :: admin console</h1>
<pre>
  > you found the room behind the room.
  > the gibson logs you in. it has been doing this for years.

  <span class="flag">${flag}</span>
</pre>
</body></html>`;

const robotsTxt = `User-agent: *
Disallow: /sys/diag
Disallow: /sys/console
`;

export const handler: ChallengeModule = {
  hints: {
    hint1: '404s lie sometimes.',
    hint2: 'real servers leak in the margins — comments, headers, robots files.',
    hint3: 'the 404 body has an HTML comment. decode it.',
    hint4: 'robots.txt lists two paths. one is a decoy, one is real.',
    hint5: 'GET /sys/console — the flag is in the body and echoed in the X-Gibson-Bypass response header.',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path === '/robots.txt') {
      reply.type('text/plain').send(robotsTxt);
      return;
    }
    if (path === '/sys/console') {
      reply.header('X-Gibson-Bypass', flag);
      reply.type('text/html').send(grantedPage(flag));
      return;
    }
    if (path === '/sys/diag') {
      reply.code(404).type('text/html').send(probeDecoy(path));
      return;
    }
    // Everything else, including '/', renders the styled 404 with the hint
    // comment. Status code 404 is honest; the comment is the breadcrumb.
    reply.code(404).type('text/html').send(notFoundPage(path));
  },
};
