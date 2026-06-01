// Challenge 1 — Follow the white rabbit.
// Public landing on example.com is a corporate-flavoured façade. View-source
// hunters find a base64 console.log + an HTML comment pointing toward /matrix;
// /robots.txt disallows /matrix; the actual flag lives on /matrix.
//
// Implementation: this challenge's page is the corporate-front example.com
// landing styled like a quiet boutique consultancy. The hidden hover hotspot
// on the footer period reveals a flavour toast — it's decoration; the real
// puzzle requires reading the console / view-source / robots.txt.

import type { ChallengeModule } from '../types.js';

const RABBIT_BASE64 = Buffer.from(
  'welcome, operator. follow the white rabbit -> /matrix\n     if you are expected, you will have a token.'
).toString('base64');

const html = (flag: string, hint: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ZeroDay</title>
  <!-- ${hint} -->
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Helvetica Neue", Arial, sans-serif;
      background: #ffffff;
      color: #1a1a1a;
      padding: 64px 72px;
      line-height: 1.5;
      max-width: 860px;
      margin: 0 auto;
    }
    h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
    h2 { font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: #8a8a8a; margin: 48px 0 16px; }
    p  { font-size: 14px; line-height: 1.6; color: #4a4a4a; margin: 0 0 12px; max-width: 560px; }
    a  { color: #1a1a1a; }
    .nav {
      display: flex;
      gap: 28px;
      font-size: 13px;
      color: #6a6a6a;
      margin-bottom: 56px;
      align-items: center;
    }
    .nav strong { color: #1a1a1a; letter-spacing: -0.01em; }
    .nav .iso { margin-left: auto; color: #b5b5b5; font-size: 11px; }
    .placeholder-img {
      background: repeating-linear-gradient(135deg, #f2f2f2, #f2f2f2 8px, #e8e8e8 8px, #e8e8e8 16px);
      height: 160px;
      display: grid;
      place-items: center;
      color: #b5b5b5;
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin: 24px 0;
      max-width: 560px;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
    }
    .card {
      border: 1px solid #e5e5e5;
      padding: 20px;
      max-width: 560px;
    }
    .card + .card { margin-top: 12px; }
    .card strong { font-size: 14px; color: #1a1a1a; }
    .card p { margin: 6px 0 0; }
    .stale {
      font-size: 11px;
      color: #b0b0b0;
      margin-top: 48px;
    }
    footer {
      margin-top: 96px;
      padding-top: 24px;
      border-top: 1px solid #eaeaea;
      font-size: 11px;
      color: #a5a5a5;
    }
    .whiterabbit {
      display: inline-block;
      width: 6px;
      height: 6px;
      color: transparent;
      cursor: help;
      transition: color 0.2s, text-shadow 0.2s;
    }
    .whiterabbit:hover {
      color: #d32f2f;
      text-shadow: 0 0 8px rgba(211,47,47,0.6);
    }
    #rabbit-toast {
      display: none;
      position: fixed;
      bottom: 24px;
      right: 24px;
      max-width: 320px;
      background: #0d0d0d;
      color: #4ade80;
      padding: 14px 18px;
      font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
      border: 1px solid #2a4d34;
      box-shadow: 0 0 24px rgba(74,222,128,0.25);
      z-index: 1000;
    }
    #rabbit-toast .head {
      font-size: 10px;
      letter-spacing: 0.14em;
      margin-bottom: 6px;
      color: #6b7280;
    }
    .whiterabbit:hover ~ #rabbit-toast,
    #rabbit-toast.shown { display: block; }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Primary">
    <strong>zeroday.</strong>
    <span>Services</span>
    <span>Compliance</span>
    <span>About</span>
    <span>Contact</span>
    <span class="iso">ISO 27001 · SOC 2 Type II</span>
  </nav>

  <h1>Quiet, careful, unremarkable.</h1>
  <p>
    ZeroDay is a boutique consultancy providing routine network audits and
    compliance documentation to small and mid-sized businesses in the
    Greater London area. We are, by design, not very interesting.
  </p>

  <div class="placeholder-img">[ stock photo: office corridor ]</div>

  <h2>What we do</h2>
  <div class="card">
    <strong>Network posture review</strong>
    <p>A quarterly walkthrough of your perimeter. No surprises. No theatre.</p>
  </div>
  <div class="card">
    <strong>Policy drafting</strong>
    <p>Boilerplate acceptable-use and incident-response documents. Mostly boilerplate.</p>
  </div>
  <div class="card">
    <strong>Vendor liaison</strong>
    <p>We speak to your insurer so you don't have to.</p>
  </div>

  <h2>Contact</h2>
  <p>
    2<sup>nd</sup> Floor, 47 Corinth Street · London<br>
    Enquiries: <a href="mailto:hello@example.com">hello@example.com</a> · +44 (0)20 7946 0118
  </p>

  <p class="stale"><em>Site last updated: January 17, 2019. Please excuse our appearance while we migrate.</em></p>

  <footer>
    © 2019 ZeroDay Ltd. All rights reserved. Registered in England &amp; Wales, Co. No. 09472341.<span class="whiterabbit" id="rabbit" title="​">.</span>
  </footer>

  <div id="rabbit-toast" role="status">
    <div class="head">→ WHITE RABBIT</div>
    click the period<br>
    or check your console<br>
    or check <strong>/matrix</strong>
  </div>

  <script>
    // psst — open devtools
    console.log("%cZERODAY // initializing audit module…", "color:#888");
    console.log("%c\\n${RABBIT_BASE64}",
      "color:#2c5f3a;font-family:monospace;font-size:11px;background:#0d0d0d;padding:4px 8px;");
    console.log("%c[audit] nothing to see here. move along.", "color:#aaa;font-style:italic;");
    window.__r = "${flag}"; // not really though
    (function () {
      var r = document.getElementById('rabbit');
      var t = document.getElementById('rabbit-toast');
      if (!r || !t) return;
      r.addEventListener('mouseenter', function () { t.classList.add('shown'); });
      r.addEventListener('mouseleave', function () { t.classList.remove('shown'); });
      r.addEventListener('click', function () { t.classList.toggle('shown'); });
    })();
  </script>
</body>
</html>`;

const matrixPage = (flag: string) => `<!doctype html>
<html><head><title>...</title><style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:2rem;}
</style></head>
<body>
<pre>
   the matrix has you.
   ${flag}
   memorize it. submit it on hack.example.com.
</pre>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'this looks like a corporate site. corporate sites are sometimes lying.',
    hint2: 'developers leave breadcrumbs in places non-users never look.',
    hint3: 'developers leave breadcrumbs. browsers have a console for a reason.',
    hint4: 'base64 is just text wearing a coat. decode the console message.',
    hint5: 'the console points to /matrix. visit it on the same host.',
  },
  async page(req, reply, { flag }) {
    const url = req.url ?? '/';
    if (url.startsWith('/matrix')) {
      reply.type('text/html').send(matrixPage(flag));
      return;
    }
    if (url === '/robots.txt') {
      reply.type('text/plain').send('User-agent: *\nDisallow: /matrix\n');
      return;
    }
    reply.type('text/html').send(html(flag, 'TODO(m): kill this before launch. recruit URL is /recruit?token=<see #matrix>. --m'));
  },
};
