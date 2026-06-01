<div align="center">

```
 ███████╗███████╗██████╗  ██████╗ ██████╗  █████╗ ██╗   ██╗
 ╚══███╔╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗╚██╗ ██╔╝
   ███╔╝ █████╗  ██████╔╝██║   ██║██║  ██║███████║ ╚████╔╝
  ███╔╝  ██╔══╝  ██╔══██╗██║   ██║██║  ██║██╔══██║  ╚██╔╝
 ███████╗███████╗██║  ██║╚██████╔╝██████╔╝██║  ██║   ██║
 ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝
                  s e q u e n t i a l   h a c k e r   h u n t
```

![CI](https://github.com/atk0309/project_zeroday/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A524-43853d)
![TypeScript](https://img.shields.io/badge/typescript-6.x-3178c6)
![Fastify](https://img.shields.io/badge/fastify-5.x-000000)
![SQLite](https://img.shields.io/badge/sqlite-better--sqlite3-003b57)
![Status](https://img.shields.io/badge/status-prelaunch-39ff14)

</div>

# ZeroDay ARG — sequential hacker hunt

> *"They said you were curious. That's a dangerous thing to be."*

A multi-subdomain ARG-style hacker treasure hunt for ~10–30 year-11/12 students. The narrative fuses **The Matrix**, **Hackers (1995)**, and **WarGames**, with real hacker-legend flavor (Mitnick, Poulsen, Torvalds, etc). Players are recruited into a shadowy collective and must clear 19 trials to "hack the GIBSON".

## How it plays

**Sequential trials.** Each player advances one stage at a time — challenge N+1 only opens once N is solved. Stuck for too long? An admin can manually skip them past a stage; the leaderboard marks the assist with a `⚠`.

**D-Day countdown.** A single big terminal-green clock drives the whole experience. Pre-launch it counts down to **GIBSON GOES LIVE**; at T-0 it flips to count down to **GIBSON GOES COLD**. When the second timer hits zero, the leaderboard freezes and the final challenge locks forever.

**Recruit anytime, gated lobby till D-Day.** Sign-up + magic-link is live immediately. Until launch, recruited operators see a CRT-themed lobby with the countdown, invitation slots, cohort wall, and atmospheric `tail -f` flavor — no challenge list. At T-0 the page transitions into the hub.

**Operator-issued invitations.** Each operator gets two invitation slots (configurable). Pending and accepted invites occupy a slot; revoke or expiry frees one. Tokens decay in 72h. Need a third? Ask the admin — there's a request flow with approve/deny in the console.

**Per-player flags.** Every flag is HMAC'd against a per-user salt. Sharing a flag across operators does **not** share access — Bob's submit endpoint rejects Alice's flag. Two strikes for supplying flags freezes the supplier; one for using someone else's freezes the consumer.

**Admin console drives all setup.** No `.env` for runtime values. The operator hits `/admin`, sets the bootstrap password via a deliberately quirky 5-click empty-fields easter egg, then configures launch/end timestamps and the mail subsystem (Resend or SMTP) through the UI.

## Quick start

```bash
# Prereqs: Node 24+, sqlite (system lib not needed; better-sqlite3 bundles it).

git clone https://github.com/atk0309/project_zeroday
cd project_zeroday
npm ci

cp .env.example .env
# Edit .env — only SESSION_SECRET, FLAG_SECRET, and PUBLIC_ORIGIN matter for runtime.

npm run migrate     # create SQLite schema + seed challenge registry
npm run dev         # tsx watch on port 3000

# In another terminal:
open http://localhost:3000/admin     # initialize the game (see docs/operator.md)
```

Production deployment via Caddy + Docker Compose lives in `ops/` — see [`docs/operator.md`](docs/operator.md). Railway hosting is documented in [`docs/hosting-railway.md`](docs/hosting-railway.md).

## Project layout

```
app/src/
  challenges/
    registry.ts          # the 19 challenges, ordered 1 → 19, with metadata
    types.ts             # ChallengeModule interface
    handlers/
      index.ts           # id → handler module mapping; stub fallback
      stub.ts            # placeholder for unauthored challenges
      *.ts               # one file per authored puzzle
  cron/dripHints.ts      # 09:00 stuck-detection job
  db/
    index.ts             # SQLite singleton + path resolution
    schema.sql           # tables (users, challenges, solves, app_settings, …)
    migrate.ts           # apply schema + additive ALTERs + seed registry
  lib/
    adminAuth.ts         # admin sessions, password, magic-link
    audit.ts             # admin_audit_log writer
    cheat.ts             # strike system, dossiers, admin recovery
    cheatDetect.ts       # shape-gated flag-supplier reverse lookup
    content.ts           # email + lobby copy (seeded defaults, token interp)
    flags.ts             # generateFlag(user, challengeId) — HMAC, per-player salt
    gibson.ts            # GIBSON key fragments + status for the setup panel
    hints.ts             # cost curve + labels
    invitations.ts       # operator invite quota, claim flow, sweep
    inviteRequests.ts    # operator → admin extra-slot requests
    mail.ts              # Resend + SMTP wrapper, env-seed
    phase.ts             # uninitialized | prelaunch | live | frozen
    playerAuth.ts        # signup, magic-link, sessions
    progress.ts          # ordinal advance + admin skip (transactional)
    settings.ts          # app_settings cache (30s TTL, write-through)
  middleware/
    adminAuthMiddleware.ts
    playerAuthMiddleware.ts   # loadPlayer / requirePlayer / enforcePlayerState
  routes/
    admin/login.ts       # the 5-click easter egg + 3-mode login
    admin/setup.ts       # first-run wizard (timing, review) + /admin/account (password, sessions, mail)
    admin/dashboard.ts   # KPIs, players, hints, audit, JSON drawer API
    admin/templates.ts   # email + lobby copy workspace
    admin/invitations.ts # admin JSON API + public /claim/:token
    hub.ts               # main player terminal at hack.example.com
    lobby.ts             # operator-side invite endpoints
    leaderboard.ts       # /board + /api/leaderboard
    recruit.ts           # red/blue pill landing
    submit.ts            # POST /api/submit, advances current_ordinal
    strikeNotice.ts      # /strike-notice (supplier) + /frozen (consumer)
    privacy.ts           # GET /privacy — cookie + analytics disclosure
  server.ts              # Fastify bootstrap, host-based subdomain dispatch, consent-banner onSend hook

app/test/                # vitest — see "Testing" below
assets/                  # author-side puzzle assets, NOT served via /static (e.g. c17/cover.png)
ops/                     # Caddyfile, docker-compose.yml, Dockerfile
scripts/check-base.mjs   # pretest guard: refuse stale-branch test runs
tools/                   # author helpers (stego-encode.py for #17, …)
web/views/
  admin/                 # login, setup, account, dashboard (dense + narrative),
                         # players, feed, hints, _topbar / _sidenav / _drawer / _head
                         # _players_invitations / _requests / _emails tabs
  hub.ejs / lobby.ejs / leaderboard.ejs / locked.ejs
  uninitialized.ejs / manual.ejs                # hub.ejs covers live + frozen + completed
  recruit-step1.ejs / recruit-decide.ejs / recruit-step2.ejs / recruit-blue.ejs
  claim.ejs / claim-dead.ejs                  # invitation claim flow
  account-frozen.ejs / strike-notice.ejs      # anti-cheat takeover screens
  privacy.ejs                                 # /privacy — cookie + analytics disclosure
web/static/
  terminal.css + terminal.js     # lobby/hub/leaderboard UI (countdown, polling)
  recruit-flow.css + recruit-flow.js  # CRT recruit theme + typewriter / boot
  violation.css                  # cheater + supplier vocabulary (klaxons, dossier)
  admin.css                      # operator-grade CRT vocabulary
  admin.js                       # drawer fetch, hint dropdowns, 5s feed polling
  consent.css + consent.js       # cookie-consent banner + Clarity gate (injected on public pages)
.github/workflows/ci.yml # ubuntu-latest, Node 24, type-check + vitest
docs/                    # operator + challenge-authoring + hosting guides
```

## Tech stack

- **Runtime**: Node 24, TypeScript (ES modules)
- **Web**: Fastify 5 + `@fastify/{cookie, formbody, view, static, rate-limit}`
- **DB**: SQLite via `better-sqlite3` (synchronous, plenty for ~30 concurrent players)
- **Templates**: EJS via `@fastify/view`
- **Auth**: argon2id for the admin password; HMAC-SHA256 for per-player flags
- **Mail**: Resend (HTTP API) or SMTP (nodemailer) — chosen at runtime via admin console
- **Cron**: `node-cron` (09:00 stuck-detection)
- **Tests**: vitest 4 with `app.inject()` for end-to-end-ish HTTP tests
- **Ops**: Caddy (wildcard TLS via Cloudflare DNS-01) + Docker Compose, or Railway

## Testing

```bash
npm test                          # vitest run — pretest hook runs check-base.mjs first
npm run test:watch                # interactive
npx tsc -p tsconfig.json --noEmit # type check
CHECK_BASE_SKIP=1 npm test        # bypass the "is your branch behind dev?" guard
```

`scripts/check-base.mjs` fails the test run if the current `claude/*` branch is behind `origin/dev`. CI sets `CI=true` so the guard skips there. Rule of thumb on a fresh session: rebase on `origin/dev` first, edit second.

## Status

| Component | Status |
|---|---|
| Sequential engine | ✅ |
| D-Day phase machine + countdown | ✅ |
| Per-player salted flag engine | ✅ |
| Admin bootstrap (5-click easter egg) | ✅ |
| Admin login (3 modes: uninitialized / password-set / mail-configured) | ✅ |
| Admin setup wizard (timing, review) | ✅ |
| Admin dashboard — dense ops + narrative variants (cookie toggle) | ✅ |
| Player detail drawer (`GET /admin/api/player/:id`) | ✅ |
| Search + stuck-only filter on players grid | ✅ |
| KPI sparklines (active <1h, submits/hr) | ✅ |
| Live feed polling (`GET /admin/api/events?since=`, 5s interval) | ✅ |
| Per-row hint dropdown (L1–L5, editable body, audit-tagged) | ✅ |
| Anti-cheat detection + 2-strike system + admin recovery | ✅ |
| Cheater takeover + supplier "we have noticed" experience | ✅ |
| Admin account screen — password rotation + sessions + mail | ✅ |
| Per-session revoke (`POST /admin/account/sessions/:id/revoke`) | ✅ |
| Player magic-link auth + sessions | ✅ |
| Lobby / hub / locked / frozen / uninitialized views | ✅ |
| Leaderboard (Stage X/19 + points + ⚠) | ✅ |
| Drip-hints cron (queues only; admin still clicks) | ✅ |
| Recruit landing (red/blue pill, goodbye memory) | ✅ |
| Operator manual at `/manual` | ✅ |
| Invitation backend — operator slots, claim flow, admin override, requests | ✅ |
| Email templates workspace (6 families + lobby flavor, live preview, test send) | ✅ |
| Caddyfile + docker-compose | ✅ |
| Railway hosting docs (production + staging) | ✅ |
| **Authored challenges** | source of truth: `authoredChallengeIds()` in `handlers/index.ts`. All 19 authored. Stub handler retained as engine fallback. |
| GIBSON key parts | `gibsonKeyStatus()` in `lib/gibson.ts`. All 3 wired (#7, #13, #17) and consumed by #19 (`hack-the-planet`). |
| OSINT page (#18) | ✅ (`ghost-shell` — per-player narrative secret on `mitnick.example.com/staff`, breadcrumb via `/robots.txt`) |
| Git repo seed (#16) | ✅ (`tools/git-seed.sh` plants the canonical secret in a public repo's history) |
| Cohort matrix view (operator × trial heatmap) | deferred |
| `tools/stego-encode.py` | ✅ (cover-generation + reference codec) |

For the live test count, run `npm test` — vitest reports it.

## More docs

- [`CLAUDE.md`](CLAUDE.md) — invariants, gotchas, code paths. **Required reading for AI assistants** picking up this repo.
- [`docs/operator.md`](docs/operator.md) — first-run setup, mail, skipping stuck players, invitations, freezing, recovery
- [`docs/authoring-challenges.md`](docs/authoring-challenges.md) — how to author a new challenge module
- [`docs/hosting-railway.md`](docs/hosting-railway.md) — production + staging on Railway, Cloudflare wildcard TLS

## License

This project is licensed under the GNU General Public License v3.0 (GPLv3) — see [`LICENSE`](LICENSE).

Copyright (C) 2026 atk0309
