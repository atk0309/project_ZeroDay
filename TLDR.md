# ZeroDay — TL;DR

A sequential hacker-themed ARG for ~10–30 high-schoolers. Recruits sign up, magic-link in, and clear **19 trials** one at a time to "hack the GIBSON".

**Vibe:** *The Matrix* + *Hackers (1995)* + *WarGames*, with nods to Mitnick, Poulsen, Torvalds, and the rest of the canon. CRT green, `tail -f` flavor, deliberately quirky easter eggs.

## The shape of it

```
  uninitialized  →  prelaunch  →   live   →   frozen
       │              │            │            │
   admin sets     countdown      19 trials   leaderboard
   timestamps     + lobby        + GIBSON    locks forever
```

A single D-Day clock drives the whole experience. Pre-launch it counts down to **GIBSON GOES LIVE**; at T-0 it flips to **GIBSON GOES COLD**. When that hits zero, the lights go out.

## Core loop

- Sequential ordinals — challenge N+1 only opens once N is solved.
- Per-player HMAC'd flags. Sharing answers doesn't share access.
- Two-strike anti-cheat: submit someone else's flag and you're frozen; supplying flags twice freezes the supplier too.
- Operator-issued invitations (2 slots each, configurable, 72h decay). Ask the admin for more.
- Admin can manually skip a stuck player; the leaderboard marks the assist with a `⚠`.

## What the operator does

- 5-click empty-fields easter egg sets the bootstrap admin password.
- `/admin` configures launch/end timestamps, mail (Resend or SMTP), copy templates, invitations, and recovery.
- No runtime `.env` for game state — everything lives in `app_settings`.
- Live event feed, audit log, integrity panel for unfreezing/clearing strikes.

## Stack

Fastify 5 + TypeScript 7 + SQLite (`better-sqlite3`), EJS views, argon2 for passwords, vitest for tests, Node 24 LTS. Deploys via Caddy + Docker Compose (see `ops/`) or Railway.

## Glossary

| term         | meaning                                                             |
|--------------|---------------------------------------------------------------------|
| **operator** | a recruited player                                                  |
| **ordinal**  | the player's current challenge index (1–19)                         |
| **flag**     | per-player `ZERODAY{...}` token, HMAC'd against `users.flag_salt`   |
| **GIBSON**   | the final boss; a 24-byte AES-192 key reconstructed from #7/#13/#17 |
| **D-Day**    | T-0 of the launch_at clock — prelaunch flips to live                |
| **frozen**   | account locked, lights-out lobby, no challenge access               |

See [`README.md`](README.md) for the player pitch, [`CLAUDE.md`](CLAUDE.md) for the agent brief, and [`docs/operator.md`](docs/operator.md) for run-day ops.
