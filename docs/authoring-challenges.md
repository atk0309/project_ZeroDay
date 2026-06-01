# Authoring a Challenge

How to fill in one of the 10 stub challenges (or alter the 9 authored ones). Audience: whoever's writing puzzles + flavor.

## The shape of a challenge

Every challenge is a TypeScript module that exports an object matching this interface (`app/src/challenges/types.ts`):

```ts
export interface ChallengeModule {
  hints: {
    hint1: string;   // L1 nudge        (-1 pt)
    hint2: string;   // L2 direction    (-2 pt)
    hint3: string;   // L3 technique    (-4 pt)
    hint4: string;   // L4 strong       (-7 pt)
    hint5: string;   // L5 near-spoiler (-10 pt)
  };
  page: (req, reply, ctx: { user: User; flag: string }) => Promise<unknown> | unknown;
}
```

Costs and labels live in `app/src/lib/hints.ts` (`HINT_COSTS`, `HINT_LABELS`, `MAX_HINT_LEVEL`); change them there if you ever rebalance.

That's it. The engine handles flag validation, ordinal advancement, leaderboard updates, and rate limits — your job is to render a puzzle page that contains (or hints at) the player's flag.

## The registry

`app/src/challenges/registry.ts` is the single source of truth for the 19 challenges' ordering, points, category, and host:

```ts
{ id: 'caesars-ghost', ordinal: 3, title: "Caesar's ghost",
  category: 'Crypto', points: 15, subdomain: 'oracle.example.com' }
```

Don't change the `id`s — they're the keys in the database (`solves`, `attempts`, `hints_sent`) and the lookup keys for the handler map. Reordering ordinals is OK before launch but breaks any in-progress games (`current_ordinal=4` would point at a different challenge).

## Authoring flow

### 1. Pick the slug from the registry

Check `app/src/challenges/registry.ts` for the `id` you're authoring. We'll use `cookie-flip` (#4, "Zero Cool's cookie") as the worked example. (Note: cookie-flip ships authored — see `app/src/challenges/handlers/cookie-flip.ts` for the real version. The walkthrough below is the simpler shape that inspired it.)

### 2. Create the handler module

Create `app/src/challenges/handlers/cookie-flip.ts`:

```ts
// Challenge 4 — Zero Cool's cookie.
// Cookie value is base64(JSON); flip admin:false → true, reload for flag.

import type { ChallengeModule } from '../types.js';

const COOKIE_NAME = 'session';

function buildCookie(admin: boolean): string {
  return Buffer.from(JSON.stringify({ user: 'guest', admin })).toString('base64');
}

const html = (admin: boolean, flag: string | null) => `<!doctype html>
<html><head><title>zero cool</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;}
  pre{font-size:1.1rem}
</style></head>
<body>
<pre>
  > welcome, guest. (admin: ${admin})
  ${admin ? `\n  ACCESS GRANTED.\n  ${flag}` : '\n  not authorized to view the cinema. how dull.\n'}
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

  async page(req, reply, { user, flag }) {
    const raw = req.cookies?.[COOKIE_NAME];
    let admin = false;

    if (raw) {
      try {
        const decoded = JSON.parse(Buffer.from(raw, 'base64').toString());
        admin = decoded?.admin === true;
      } catch { /* malformed cookie → admin stays false */ }
    } else {
      // First visit: set the bait cookie.
      reply.setCookie(COOKIE_NAME, buildCookie(false), {
        path: '/', httpOnly: false, sameSite: 'lax',
      });
    }

    reply.type('text/html').send(html(admin, admin ? flag : null));
  },
};
```

### 3. Wire it into the handler map

`app/src/challenges/handlers/index.ts`:

```ts
import { handler as cookieFlip } from './cookie-flip.js';

const authored: Record<string, ChallengeModule> = {
  'white-rabbit': whiteRabbit,
  'no-spoon': noSpoon,
  'caesars-ghost': caesarsGhost,
  'cookie-flip': cookieFlip,   // ← add this line
};
```

The stub remains the fallback — any id not in `authored` keeps using `makeStub(meta)`.

### 4. Test it

```bash
npm run dev
# Sign up as a player, advance to ordinal 4 (admin skip if needed),
# visit the puzzle, solve it, watch your current_ordinal advance to 5.
```

For automated coverage, add a focused test in `app/test/`. The existing `submit.test.ts` shows how to drive `app.inject()` with a logged-in player session.

## Per-player flags — what `flag` is

Your `page()` handler receives a `flag` string already prepared for *this user*: `ZERODAY{<24-hex-chars>}`. It's deterministic for `(user.flag_salt, challenge_id)` but different across users. You don't need to call any helpers — just embed it in the response.

This is why sharing answers doesn't share access: if Alice solves cookie-flip and DMs her flag to Bob, Bob's submit endpoint will reject it (Bob's flag is computed against Bob's salt). The verifier in `lib/flags.ts:verifyFlag` does this check for you.

## Where to embed the flag

Different categories want different vehicles:

- **Web / DevTools** (cookies, headers, client-side JS): set the flag in a cookie value, custom response header (`X-Gibson-Access: ZERODAY{...}`), inline JS variable, or HTML comment after the player has met some condition.
- **Crypto**: encode the flag (ROT13, base64-stack, XOR with a known-plaintext-recoverable key) and serve the ciphertext. The player decodes it, then submits the decoded string. Note: pure ASCII transforms preserve the `ZERODAY{...}` wrapper structure even after rotation, since `{`, `}`, and digits are unchanged.
- **Net**: serve the flag on a non-standard port (Caddy's `:31337` listener), via a DNS TXT record (`_secret.example.com`), only on a specific HTTP method (`OPTIONS`/`PATCH`), or behind a method/header guard.
- **Logic / Python**: an interactive endpoint that requires the player to interact correctly N times (e.g. WOPR's "the only winning move is not to play").
- **Final** (`hack-the-planet`, #19): assemble the 3 key-parts embedded in #7, #13, #17, decrypt the boss message with them.

## Hint authoring

Five strings, five intensities. Keep them in voice — terse, slightly menacing, never patronizing. The convention from the authored examples:

```ts
hints: {
  hint1: 'a gentle vibe-only nudge — name the genre, not the move',
  hint2: 'a one-line direction — point at the surface to inspect',
  hint3: 'a one-line nudge that names the *category* of skill needed',
  hint4: 'a stronger hint that names the *specific technique*',
  hint5: 'a near-spoiler that walks through the steps without quite saying the answer',
}
```

The admin dashboard pulls these strings into the hint email when you click L1–L5 for a stuck player. If you want flavor wrapping, the email already adds it (`"the operators noticed you've been stuck on..."`); your hints should be the actionable content. Costs scale: L1 = 1pt, L2 = 2pt, L3 = 4pt, L4 = 7pt, L5 = 10pt — the spoiler ceiling is fixed; rebalance via `lib/hints.ts:HINT_COSTS`.

## Subdomain considerations

The registry assigns each challenge to a subdomain. The host-based dispatcher in `server.ts` looks up `challenges.filter(c => c.subdomain === host)` and routes the request to that challenge's handler — *if* it's the player's current ordinal. So if Alice is on stage 3 (`oracle.example.com`) and visits stage 4 (`zero.example.com`), she gets the locked page.

When authoring, you can write your handler as if it owns the whole host — e.g. handle multiple paths (`/`, `/matrix`, `/robots.txt`) within `page()` by checking `req.url`. The white-rabbit example does exactly this.

## GIBSON key parts (#7, #13, #17, #19)

The 3 key-parts combine into the AES key that #19 needs. Storage is centralised in `app/src/lib/gibson.ts`:

```ts
export const GIBSON_KEY_PARTS: Record<1|2|3, string> = {
  1: 'A1B2C3D4E5F60718',  // wired by #7 matryoshka
  2: '9E7B5C3A11D22F08',  // wired by #13 ports-of-call
  3: 'D3FACEB14C0DE5A1',  // wired by #17 stego-static
};
```

Per-stage:

- **Stage 7 (Matryoshka)** ✅: the unwrapped payload's second line is `gibson_key_part_1=<hex>`. The hex is read from `GIBSON_KEY_PARTS[1]`.
- **Stage 13 (Ports of call)** ✅: the in-order dial solve appends `renderKeyFragment(2)` after the flag block. The hex is read from `GIBSON_KEY_PARTS[2]`.
- **Stage 17 (Stego in the static)** ✅: the per-player PNG served at `/static.png` carries `flag=...\ngibson_key_part_3=<hex>` in its RGB low bits (matryoshka pattern, not a `renderKeyFragment` block — the prize of stego is the extracted key). Cover image lives at `assets/c17/cover.png` and is regeneratable via `tools/stego-encode.py generate-cover`. The runtime encoder + Python reference codec share one bit-level protocol, documented at the top of both files.
- **Stage 19 (Hack the planet)** ✅: takes the 3 parts as input via `?k1=&k2=&k3=`, reconstructs the 24-byte AES-192 key (`GIBSON_KEY_PARTS[1] + [2] + [3]`, raw hex), derives a per-user CBC IV from `HMAC-SHA256(flag_salt, 'gibson-iv').slice(0,16)`, and decrypts a personal "welcome to the collective" plaintext containing the player's flag. Decrypt happens server-side so the failure mode is "key fragment N rejected" instead of opaque cipher noise; per-fragment validation is exact case-insensitive hex compare against the canonical constants. Frozen-phase short-circuit lives upstream at `routes/hub.ts` (and the subdomain dispatcher in `server.ts`) — the handler is never called once `end_at` is past.

The registry's `embedsKeyPart` field is documentation; nothing checks it at runtime yet. Any remaining placeholders in `lib/gibson.ts` use the `__PLACEHOLDER_KN__` sentinel so a grep for `PLACEHOLDER_K` finds the next thing to fill in.

### Authoring assets

Long-form puzzle assets that aren't player-facing static files (covers for steganography, source PDFs, audio masters, etc.) live under the top-level `assets/` directory and are loaded by their handler via `fs.readFileSync` at module load. They are deliberately **not** under `web/static/` — that directory is served at `/static/` to every host, and serving a stego cover there would let players diff served-vs-cover and recover the LSB stream trivially. Generation/manipulation scripts live under `tools/`; today only `tools/stego-encode.py` exists (`generate-cover` / `encode` / `decode` for #17, Pillow-based).

## Tests

The 46-case suite covers the engine and the per-puzzle authored handlers. For a new authored challenge, the smallest useful test is:

```ts
// app/test/cookie-flip.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';
import { findOrCreateUser, createSession } from '../src/lib/playerAuth.js';
import { adminSkip } from '../src/lib/progress.js';
import * as settings from '../src/lib/settings.js';

beforeAll(() => {
  applySchema();
  settings.setMany({
    launch_at: new Date(Date.now() - 86400_000).toISOString(),
    end_at:    new Date(Date.now() + 86400_000).toISOString(),
  });
});

describe('challenge: cookie-flip', () => {
  it('reveals the flag only when admin cookie is true', async () => {
    const app = await build();
    const u = findOrCreateUser('cf@example.com', 'cf-tester');
    // Skip them up to ordinal 4
    for (let i = 1; i <= 3; i++) adminSkip(u.id, i);
    const sid = createSession(u.id);

    const cookieAdminTrue = Buffer.from(JSON.stringify({ user: 'x', admin: true }))
      .toString('base64');
    const r = await app.inject({
      method: 'GET', url: '/c/4',
      headers: {
        cookie: `player_session=${sid}; session=${cookieAdminTrue}`,
        host: 'zero.example.com',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/ZERODAY\{[A-F0-9]{24}\}/);
  });
});
```

## The CRT aesthetic

Stay in voice. The terminal theme isn't decoration — it's the diegesis. A few rules of thumb:

- **Lowercase**, except for the SHOUTING moments (`ACCESS GRANTED`, `LIGHTS OUT`, the flag itself).
- **Short clipped sentences**. Period-end-of-line. No emoji except in the recruit pills (🔴 / 🔵).
- **Reference the legends** when you can — Mitnick, Poulsen, Trinity, Morpheus, Acid Burn, WOPR. The kids who get the references will smile.
- **Never break character to explain.** If a hint says "this is base64", that's fine — base64 is in-universe ASCII. But "open Chrome devtools" should become "developers leave breadcrumbs. browsers have a console for a reason."

## Common gotchas

- **Don't bypass the ordinal guard.** The host-based dispatcher already handles "is this player allowed to see this challenge?". If you find yourself adding ordinal checks inside `page()`, you're working against the engine.
- **Don't store per-player state in module scope.** Modules are imported once per process; state shared across players will leak. Use the database (write to `events` if you need to log, or add a new table for per-(user, challenge) state).
- **Public face vs gated face.** Challenge #1 (`white-rabbit`) is the only handler currently designed to render *anything* for unauthenticated visitors (the "boring corporate front" on `example.com`). All other handlers can assume `req.player` is set — the dispatcher in `server.ts` ensures it. If you write a new public-facing puzzle, replicate the unauthed branch from `server.ts:onRequest`.
- **The flag preview in `/api/me`.** In `NODE_ENV=development`, `/api/me` returns the player's expected flag for their current challenge. Use this to playtest without grinding through every puzzle. Disabled in production.
