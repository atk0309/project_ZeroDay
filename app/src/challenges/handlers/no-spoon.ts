// Challenge 2 — There is no spoon.
// Flag hidden in HTML comment + a CSS-hidden div on the post-signup welcome.
import type { ChallengeModule } from '../types.js';

const html = (flag: string, alias: string) => `<!doctype html>
<html><head><title>welcome, ${alias}</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;}
  .invisible{display:none;}
  h1{font-weight:normal;}
</style></head>
<body>
<h1>welcome, ${alias}.</h1>
<p>look closer.</p>
<!-- ${flag} -->
<div class="invisible">${flag}</div>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the welcome page is hiding more than it shows.',
    hint2: 'a casual reader sees the rendered page; you can ask for the source.',
    hint3: 'you have devtools. you know what to do.',
    hint4: 'view source. read every line. some things hide in plain sight.',
    hint5: 'check the HTML comments and elements with display:none.',
  },
  async page(req, reply, { user, flag }) {
    reply.type('text/html').send(html(flag, user.alias));
  },
};
