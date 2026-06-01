# PR-B Brief — Author challenges #14 (shall-we-play) + #15 (crack-wopr)

> **Audience:** A fresh Claude Code session that has never seen this codebase or the prior planning conversation. Read this end-to-end **before** opening any source file. The intent is that you can execute PR-B with no further context from a human.

---

## 0. Mission

Author the next two unauthored challenges in the ZeroDay ARG:

| # | id | Category | Host | Points |
|---|---|---|---|---|
| 14 | `shall-we-play` | Logic | `wopr.example.com` | 35 |
| 15 | `crack-wopr` | Crypto | `wopr.example.com` | 40 |

Both currently fall through to the stub handler at `app/src/challenges/handlers/stub.ts`. Replace each with a real authored handler, register them, ship tests, and walk the documentation pass that `CLAUDE.md` mandates.

PR-A landed on a separate branch (`claude/plan-next-challenges-6rfLT`) and authored #17 (stego-static) plus the GIBSON key part 3 wiring. **If PR-A has merged into `origin/dev` by the time you start, you inherit it for free** — no action needed. If it hasn't, your branch will conflict on `app/src/challenges/handlers/index.ts`, `CLAUDE.md`, and `README.md`; rebase your branch on top of `origin/dev` once PR-A merges, or cut from PR-A's branch directly. Don't re-do PR-A's work.

---

## 1. Required reading, in this order

1. **`CLAUDE.md`** top to bottom. The "Invariants" section is load-bearing — re-derive any of them wrong and something silently breaks. Pay special attention to invariants 1, 2, 3, 8.
2. **`docs/authoring-challenges.md`** — the full how-to. Includes a worked example, the per-player flag explanation, hint-cost curve, subdomain dispatch contract.
3. **`app/src/challenges/registry.ts`** — confirm both slugs and the `wopr.example.com` host string verbatim. Don't change `id`s.
4. **`app/src/challenges/handlers/ports-of-call.ts`** — closest analog for #14 (same WOPR host, same Logic-vs-Net feel, demonstrates query-string-encoded multi-step interactions on a single GET, demonstrates the `evaluateDial` pure-function-then-handler split that makes testing pleasant).
5. **`app/src/challenges/handlers/xor-oracle.ts`** — closest analog for #15 (Crypto, hash/cipher mechanic). Skim, don't memorize.
6. **`app/src/challenges/handlers/method-madness.ts`** — also on `wopr.example.com`; useful for tonal consistency on that host.
7. **`app/test/ports-of-call.test.ts`** — the test shape to mirror for both new challenges (pure-function tests + `app.inject()` route tests + per-player isolation test + host-routed-via-subdomain test).

---

## 2. Branch flow (do this first)

```bash
git fetch origin dev
git checkout -b claude/<your-topic> origin/dev   # NOT off main
git rebase origin/dev                            # confirm clean baseline
npm ci
CHECK_BASE_SKIP=1 npm test                       # baseline must pass
npx tsc -p tsconfig.json --noEmit                # baseline must pass
```

The `pretest` hook will fail any test run on a branch behind `origin/dev`. Set `CHECK_BASE_SKIP=1` only on a branch you've already rebased or for one-off local runs.

---

## 3. Challenge #14 — "Shall we play a game?"

### Theme

WarGames (1983). The WOPR greets the player ("Greetings, Professor Falken. Shall we play a game?"), offers a menu of games, and refuses to lose Global Thermonuclear War — the canonical line is **"the only winning move is not to play."** That line is the puzzle.

### Mechanic (recommended)

A single GET endpoint on `wopr.example.com` that progresses through states encoded entirely in the query string — same shape as `ports-of-call.ts`. **No new database table, no session storage, no per-(user, challenge) state.** Server is pure; the URL is the state machine.

States, all driven by `?game=<slug>&move=<slug>`:

| `game` | `move` | Server response |
|---|---|---|
| absent | absent | Render the WOPR menu: list ~6 games (Falken's Maze, Black Jack, Chess, Poker, Theaterwide Biotoxic and Chemical Warfare, Global Thermonuclear War). Each is a link with `?game=<slug>`. |
| any solvable game (e.g. `chess`, `tic-tac-toe`, `checkers`) | absent | Render "you can win this one. but you didn't come here to win." Offer two links: `?game=<slug>&move=play` (carrier-dropped flavor) and a generic "step away" link the player has to recognize. |
| `global-thermonuclear-war` | absent | Render the LATERAL DEFENSE board flavor + two links: `?game=...&move=play` (WOPR runs simulations forever) and `?game=...&move=cease` (or whatever you pick — see below) which fires the solve. |
| any | `play` | "carrier engaged. simulation running… [no flag]" (intentional dead-end). |
| `global-thermonuclear-war` | `cease` (or your chosen "refuse" verb) | **Solve.** Render flag in CRT-styled block. |

Choose your "refuse" verb thoughtfully. Candidates: `cease`, `none`, `quit`, `step-away`, `not-to-play`. Recommendation: `cease` (short, in-voice, lowercases nicely). Make sure the menu copy hints at it without naming it.

The page also surfaces, in a "WOPR is reasoning…" footer panel, the literal sentence "_strange game. the only winning move is not to play._" once the player has selected `global-thermonuclear-war` but not yet moved. That's the L4-L5-strength in-page nudge; the puzzle is recognizing the line as instruction, not flavor.

### Why this design

- Single GET, no state — mirrors `ports-of-call.ts` and matches the engine's stateless-handler grain. CLAUDE.md is explicit: "Don't store per-player state in module scope" — and the cleanest way to honor that is "don't store per-player state at all."
- Player can refresh the URL and arrive at the solve idempotently — no fragile turn counters.
- Tests are trivial: pure function `evaluateMove(game, move)` returns `'menu' | 'game-selected' | 'dead-end' | 'solved'`; the route test asserts each branch.

### Files

- Create: `app/src/challenges/handlers/shall-we-play.ts`
- Create: `app/test/shall-we-play.test.ts`

### Hints (5-tier, in voice)

Skeleton — final wording is yours to refine in voice (lowercase, terse, references the legends):

- L1 — "the wopr loves a game. that doesn't mean you should play one."
- L2 — "the menu is the puzzle. the right move is not in the menu's branches — it's beside them."
- L3 — name the film: WarGames (1983). Falken's quote.
- L4 — "the only winning move is not to play. your job is to enact that, not quote it."
- L5 — "select global thermonuclear war. then refuse to play. the link you want is `?move=cease`."

---

## 4. Challenge #15 — "Crack the WOPR"

### Theme

WOPR/Falken's password. In the film it's `joshua` (Falken's dead son's name). Lean into the lore.

### Mechanic (recommended)

Two-step interaction on `wopr.example.com`, both via GET:

1. **Landing**: render an authentication prompt and a published hash digest. The hash is the canonical `joshua` digest (NOT per-player — see "Why canonical" below). Include a tiny in-page wordlist hint: "system reads from the falken family register. spouse, son, dog, maze." (i.e. ~6 candidate words including `joshua`, `helen`, `stephen`, `david`, etc.) The player cracks offline (or just guesses from the lore) and submits the password back via `?login=<word>`.
2. **Login**: if `?login=joshua`, render WOPR's "GREETINGS, PROFESSOR FALKEN" sequence followed by the per-player flag. Otherwise render an in-voice wrong-password message and re-render the prompt.

### Hash choice

Use **SHA-256** of the literal byte string `joshua` (no salt). Publish the digest on the page as a 64-char lowercase hex. Hashcat mode `1400`, john `Raw-SHA256`. Even without those tools, a player who recognizes the wordlist hint can guess from the film.

Don't use argon2 / bcrypt / scrypt — they're calibrated for slowness and would be mean for a CTF that's already gated on lore recognition. Don't use MD5 — it gives the wrong era signal for WOPR (1983 mainframe). SHA-256 is the right boring default.

### Why canonical (not per-player)

The puzzle is "crack one hash" — that has a known, satisfying answer (`joshua`). If you make the hash per-player-salted, every player has to actually run a cracker, AND the wordlist becomes longer than `joshua` is famous, AND the lore payoff is muddied. The per-player isolation already lives in the **flag** that gets rendered on success — not in the hash itself.

### Files

- Create: `app/src/challenges/handlers/crack-wopr.ts`
- Create: `app/test/crack-wopr.test.ts`

### Hints

- L1 — "the system trusts a name. one name."
- L2 — "you have a digest and a hint. that's everything a cracker needs."
- L3 — name the film: WarGames. The password belongs to Falken's family.
- L4 — "sha-256, no salt. wordlist of ~6 words from the film. hashcat mode 1400."
- L5 — "the password is `joshua`. submit `?login=joshua`."

### Open question to surface to the user

Before authoring #15, ask the user once via `AskUserQuestion`:

> "For #15 crack-wopr: confirm SHA-256(`joshua`) as the canonical password+hash, no salt? Alternatives: per-player-salted (harder, less lore payoff) or a different password from the film (`pencil`, `helen`, etc.)."

Default to SHA-256 of `joshua` if the user says "you pick."

---

## 5. House conventions you must honor

These come from `CLAUDE.md` "House conventions" + reading the existing handlers:

- **ES modules.** TS imports use `.js` extensions even though source is `.ts` (`moduleResolution: "bundler"`).
- **Top-level `db.prepare(...)` runs at import time** (invariant #8). If your handler module touches the DB at module load, schema must already be applied. The simpler path: don't touch the DB. Both #14 and #15 above are stateless and need zero DB.
- **No template-string SQL.** Use `db.prepare(...)` once, `.run(...)` per call. Not relevant if you stay stateless.
- **Comments favor the WHY, not the what.** Match the tone of `ports-of-call.ts:1–15` (a header block explaining the mechanic and the canonical answer).
- **CRT aesthetic, lowercased, terse.** Period-end-of-line. No emoji. Reference the legends. See the bottom of `docs/authoring-challenges.md`.
- **Inline `escapeHtml` per-handler.** That's the house style — don't extract a shared util. Copy the 5-line block from `ports-of-call.ts:44`.
- **Per-player flag**: `page()` receives `{ user, flag }`. The `flag` is already prepared for this user. Just embed it in the success branch. Don't call `generateFlag` yourself.

---

## 6. Wiring up

After authoring, modify `app/src/challenges/handlers/index.ts`:

```ts
import { handler as shallWePlay } from './shall-we-play.js';
import { handler as crackWopr } from './crack-wopr.js';

const authored: Record<string, ChallengeModule> = {
  // … existing entries …
  'shall-we-play': shallWePlay,
  'crack-wopr':    crackWopr,
};
```

That's the only registration. The host dispatcher (`app/src/server.ts`) and the hub route (`app/src/routes/hub.ts:/c/:ordinal`) pick up the new handlers automatically once they're in the `authored` map.

---

## 7. Tests

Mirror the shape of `app/test/ports-of-call.test.ts`. For each challenge ship at minimum:

1. **Pure-function tests** — if you split state evaluation into a pure function (recommended), test each branch (`evaluateMove(...)` for #14, `verifyPassword(...)` for #15) without spinning up Fastify.
2. **Landing render** — skip user to ordinal N, GET the hub URL, expect 200 + flavor copy + **no flag in body**.
3. **Solve render** — GET with the canonical solve query (`?game=global-thermonuclear-war&move=cease` for #14, `?login=joshua` for #15), expect 200 + per-player flag in body.
4. **Wrong solve** — GET with a near-miss query, expect 200 + flavor copy + no flag.
5. **Subdomain dispatch** — same solve via `host: wopr.example.com` instead of `/c/N`, confirm parity.
6. **Per-player isolation** — two players solve, each gets *their own* flag, neither sees the other's.

Test setup boilerplate (`beforeAll(applySchema)`, `settings.setMany({launch_at, end_at})`, `skipTo(userId, N)`, `findOrCreateUser`, `createSession`) is identical to `ports-of-call.test.ts`. Copy the pattern verbatim — `applySchema()` is a no-op stub, the real schema apply happens in `app/test/setup.ts` via vitest's `setupFiles`.

---

## 8. Documentation pass (CLAUDE.md mandates this — not a follow-up)

Walk this checklist; each line is trigger → file:

- New audit-log action / event kind → vocabulary lists in `CLAUDE.md` "Schema gotchas". Both challenges above add neither — confirm and move on.
- New `app_settings` key → `lib/settings.ts:SettingKey`. Neither challenge above adds one — confirm and move on.
- New invariant → `CLAUDE.md` "Invariants". Neither challenge needs one — confirm and move on.
- **`CLAUDE.md` "What hasn't been built"**: drop #14 and #15 from the stub-list line; update the count. After PR-A and PR-B together, the line reads: "Challenges 16, 18, 19 use the stub handler. 1–15 and 17 are authored."
- **`README.md` Status table**: bump the "**Authored challenges**" row from `14 of 19 (1–13, 17)` (PR-A's number) to `16 of 19 (1–15, 17)`. If PR-A hasn't merged when you start, the pre-state will be `13 of 19 (1–13)` and your post-state is still `15 of 19 (1–15)` — but you'll then conflict with PR-A's edit; rebase resolves it.
- **`docs/authoring-challenges.md`**: nothing must change for these two challenges (they don't introduce new patterns). Confirm in the PR body.

State doc impact in the PR body: either link the doc lines you touched, or write `Docs: CLAUDE.md "What hasn't been built", README.md status table.`

---

## 9. Verification

```bash
npx tsc -p tsconfig.json --noEmit            # must pass
CHECK_BASE_SKIP=1 npm test                   # full suite must pass
npm run dev                                   # then manual playthrough below
```

Manual playthrough on `npm run dev`:

1. Sign up (red pill on `/recruit`), capture magic-link from server logs.
2. As admin, set `launch_at` in the past via `/admin/setup`.
3. Admin-skip the player to ordinal 14 (use the dashboard's per-player skip control or call the skip endpoint directly).
4. Visit `/c/14`. See the WOPR menu. Click around. Confirm `global-thermonuclear-war` → `cease` is the only path that surfaces a flag.
5. Submit the flag in the hub. `current_ordinal` advances to 15.
6. Visit `/c/15`. See the auth prompt + hash. Submit `?login=joshua`. See "GREETINGS, PROFESSOR FALKEN" + flag.
7. Submit. Advance to 16.

---

## 10. Out of scope

- Challenges 16, 18, 19 — those are PR-C.
- Closing `/recruit` to invite-only.
- Any rebalance of `HINT_COSTS` or per-challenge `points`.
- Adding new `app_settings` keys, new event kinds, or new audit-log actions.
- Touching the cheat-detect / strike machinery.

---

## 11. Commit + push

Single commit, conventional-commits subject, body explains the why and lists doc impact. Pattern from recent dev history:

```
feat(challenges): author #14 shall-we-play + #15 crack-wopr

#14 (Shall we play a game?, Logic, 35pt, wopr.example.com) is a stateless
WOPR menu where the only solve path is to refuse Global Thermonuclear War —
?game=global-thermonuclear-war&move=cease. Mirrors ports-of-call's
single-GET-state-in-query-string design; no new schema, no per-player state.

#15 (Crack the WOPR, Crypto, 40pt, wopr.example.com) presents a canonical
SHA-256 digest of `joshua` (Falken's son, WarGames lore) plus a tiny
in-page wordlist hint. ?login=joshua reveals the per-player flag.

Docs: CLAUDE.md "What hasn't been built" (drop #14 and #15 from stub list),
README.md status table (16 of 19 authored).
```

Push to `origin` with `-u`. Do **not** open a pull request unless the user explicitly asks.

---

## 12. If anything in this brief contradicts what you find in `CLAUDE.md` or the existing handlers

`CLAUDE.md` and the actual code win. This brief is a planning artifact written before the work started; the codebase is the source of truth. If you spot a contradiction (e.g. a new invariant landed on `dev` between when this was written and when you're reading it), follow the codebase and note the divergence in your PR body.
