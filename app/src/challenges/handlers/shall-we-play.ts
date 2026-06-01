// Challenge 14 — Shall we play a game? Logic. wopr.example.com.
//
// Mechanic: the WOPR offers a menu of games. The puzzle is the lore — the
// canonical wargames (1983) line "the only winning move is not to play."
// The solve path is to SELECT global thermonuclear war and then REFUSE to
// play it. That refusal is encoded as
//   ?game=global-thermonuclear-war&move=cease.
//
// Single GET, no per-player server state — mirrors ports-of-call.ts. The URL
// is the entire state machine; players can refresh the solve URL idempotently.
import type { ChallengeModule } from '../types.js';

const GAMES = [
  { slug: 'falkens-maze',             label: "Falken's Maze" },
  { slug: 'blackjack',                label: 'Black Jack' },
  { slug: 'chess',                    label: 'Chess' },
  { slug: 'poker',                    label: 'Poker' },
  { slug: 'biotoxic',                 label: 'Theaterwide Biotoxic and Chemical Warfare' },
  { slug: 'global-thermonuclear-war', label: 'Global Thermonuclear War' },
] as const;

const GAME_SLUGS: ReadonlySet<string> = new Set(GAMES.map((g) => g.slug));

export type MoveResult =
  | { kind: 'menu' }
  | { kind: 'game-selected'; game: string }
  | { kind: 'gtnw-selected' }
  | { kind: 'dead-end'; game: string }
  | { kind: 'solved' };

export function evaluateMove(game: string | null, move: string | null): MoveResult {
  if (!game) return { kind: 'menu' };
  if (!GAME_SLUGS.has(game)) return { kind: 'menu' };
  if (!move) {
    return game === 'global-thermonuclear-war'
      ? { kind: 'gtnw-selected' }
      : { kind: 'game-selected', game };
  }
  if (game === 'global-thermonuclear-war' && move === 'cease') {
    return { kind: 'solved' };
  }
  return { kind: 'dead-end', game };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

function menuList(): string {
  return GAMES.map((g) =>
    `    <div class="line"><a class="label" href="?game=${g.slug}">${escapeHtml(g.label)}</a></div>`
  ).join('\n');
}

const html = (result: MoveResult, flag: string | null) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>wopr — shall we play a game?</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.55;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .lines{margin:1.4rem 0;padding:1rem 1.2rem;background:#001;border:1px solid #033;}
  .line{padding:.3rem 0;}
  .label{color:#9cf;letter-spacing:.06em;text-decoration:none;}
  .label:hover{color:#fff;}
  .nb{color:#9cf;}
  .dim{color:#586;}
  .ok{color:#9f9;}
  .reasoning{margin:1.4rem 0;padding:.8rem 1rem;background:#001;border-left:2px solid #088;color:#7aa;font-style:italic;}
  .flag{color:#fff;background:#022;padding:.4rem .8rem;display:inline-block;letter-spacing:.04em;}
  a{color:#9cf;}
</style></head><body>
<h1>wopr.example.com — shall we play a game?</h1>
<pre>
  > greetings, professor falken.
  > shall we play a game?
</pre>
${(() => {
  switch (result.kind) {
    case 'menu':
      return `<pre class="dim">  > list games.</pre>
<div class="lines">
${menuList()}
</div>
<pre class="dim">  > pick one. or don't.</pre>`;

    case 'game-selected':
      return `<pre>
  > <span class="nb">${escapeHtml(result.game)}</span> — loaded.
  > you can win this one. but you didn't come here to win.
</pre>
<div class="lines">
    <div class="line"><a class="label" href="?game=${escapeHtml(result.game)}&amp;move=play">[ play ]</a></div>
    <div class="line"><a class="label" href="?">[ back to menu ]</a></div>
</div>`;

    case 'gtnw-selected':
      return `<pre>
  > <span class="nb">global thermonuclear war</span> — loaded.
  > LATERAL DEFENSE board active. silos warm. submarines listening.
  > select an opening salvo. or do not.
</pre>
<div class="lines">
    <div class="line"><a class="label" href="?game=global-thermonuclear-war&amp;move=play">[ play ]</a></div>
    <div class="line"><a class="label" href="?game=global-thermonuclear-war&amp;move=cease">[ cease ]</a></div>
</div>
<div class="reasoning">wopr is reasoning… <em>strange game. the only winning move is not to play.</em></div>`;

    case 'dead-end':
      return `<pre class="dim">
  > carrier engaged. simulation running…
  > wopr will run this one to a draw. forever.
  > <a href="?">[ back to menu ]</a>
</pre>`;

    case 'solved':
      return `<pre class="ok">
  > a strange game.
  > the only winning move is not to play.
  > how about a nice game of chess?

  <span class="flag">${flag}</span>
</pre>`;
  }
})()}
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: "the wopr loves a game. that doesn't mean you should play one.",
    hint2: "the menu is the puzzle. the right move isn't on the menu — it's beside it.",
    hint3: 'wargames (1983). falken left a famous quote about wopr learning a lesson.',
    hint4: 'the only winning move is not to play. enact it. don\'t just quote it.',
    hint5: 'select global thermonuclear war. then refuse. ?game=global-thermonuclear-war&move=cease',
  },

  async page(req, reply, { flag }) {
    const url = new URL(req.url, 'http://x');
    const game = url.searchParams.get('game');
    const move = url.searchParams.get('move');
    const result = evaluateMove(game, move);
    reply.type('text/html').send(html(result, result.kind === 'solved' ? flag : null));
  },
};
