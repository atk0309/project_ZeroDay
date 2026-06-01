// Challenge 6 — DNS whispers.
// A simulated `dig` tool. Most queries return NXDOMAIN. A handful of canned TXT
// records exist on the wopr.example.com zone. The flag lives at:
//   _secret.wopr.example.com  (TXT)
// Player has to know to query an underscore-prefixed TXT record. Visible
// "_motd" and "_operator" records nudge them at the underscore convention.
import type { ChallengeModule } from '../types.js';

interface FakeRecord {
  name: string;
  type: 'TXT';
  rdata: (flag: string) => string; // closure so the flag is per-player
}

const ZONE = 'wopr.example.com';

const records: FakeRecord[] = [
  {
    name: `_motd.${ZONE}`,
    type: 'TXT',
    rdata: () => '"war games. the only winning move is not to play."',
  },
  {
    name: `_operator.${ZONE}`,
    type: 'TXT',
    rdata: () => '"phone the operator. the line is hot but quiet. mind the underscores."',
  },
  {
    name: `_secret.${ZONE}`,
    type: 'TXT',
    rdata: (flag) => `"${flag}"`,
  },
];

function dig(name: string, flag: string): { found: FakeRecord | null; normalized: string } {
  const normalized = name.trim().toLowerCase().replace(/\.$/, '');
  const found = records.find((r) => r.name === normalized) ?? null;
  return { found, normalized };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

const page = (queried: string | null, found: FakeRecord | null, flag: string) => {
  const ts = new Date().toUTCString();
  const queriedEsc = queried === null ? '' : escapeHtml(queried);
  const result = queried === null
    ? ''
    : found
      ? `
; <<>> ZeroDay simulated dig 9.x <<>> ${queriedEsc} TXT
;; ANSWER SECTION:
${found.name}.\t300\tIN\tTXT\t${found.rdata(flag)}

;; Query time: 7 msec
;; SERVER: 127.0.0.53#53
;; WHEN: ${ts}
`
      : `
; <<>> ZeroDay simulated dig 9.x <<>> ${queriedEsc} TXT
;; status: NXDOMAIN, id: 0xC0FF
;; flags: qr aa rd ra; QUERY: 1, ANSWER: 0

;; Query time: 4 msec
;; SERVER: 127.0.0.53#53
;; WHEN: ${ts}
`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>wopr — dns lookup</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.5;}
  h1{font-weight:normal;letter-spacing:.04em;}
  pre{font-size:1.0rem;background:#001;padding:1rem;border:1px solid #033;}
  form{margin:1.2rem 0;}
  input[type=text]{background:#000;color:#0f0;border:1px solid #0a0;padding:.4rem .6rem;font-family:inherit;width:28rem;max-width:60vw;}
  button{background:#022;color:#0f0;border:1px solid #0a0;padding:.4rem 1rem;font-family:inherit;cursor:pointer;}
  .nb{color:#9cf;}
  .dim{color:#070;}
</style></head><body>
<h1>wopr.example.com — dialup directory</h1>
<pre>
  > simulated dns lookup tool
  > zone: ${ZONE}
  > supported types: TXT
  > <span class="nb">examples:</span> _motd.${ZONE} | _operator.${ZONE}
</pre>
<form method="get">
  <input type="text" name="name" placeholder="_motd.${ZONE}" value="${queriedEsc}" autofocus>
  <button type="submit">dig</button>
</form>
${queried !== null ? `<pre>${result.trim()}</pre>` : '<pre class="dim">; no query yet. type a name above.</pre>'}
</body></html>`;
};

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the operator speaks in pre-arranged whispers. learn the language first.',
    hint2: "the page tells you what records it can answer. it doesn't tell you all the names.",
    hint3: 'WOPR was a phone-line nerd. before APIs, machines whispered through DNS.',
    hint4: 'DNS records carry more than addresses. TXT records carry text — try those.',
    hint5: `query the TXT record at _secret.${ZONE}.`,
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const queried = url.searchParams.get('name');
    const { found } = queried ? dig(queried, flag) : { found: null };
    reply.type('text/html').send(page(queried, found, flag));
  },
};
