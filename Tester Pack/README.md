# Tester Pack

> Drop-in walkthrough material for end-to-end-testing the ZeroDay ARG.

This folder is the tester's home base. It walks you from a clean checkout through admin bootstrap, player signup, and all 19 challenges in order. You don't need to read the source. Follow the docs and you'll clear the game.

---

## Run order

1. **`00 - Setup/Setup.md`** — boot the app, become admin, configure timing, sign up as a player, capture your session cookie.
2. **`01 - Admin Walkthrough/Admin Walkthrough.md`** — what to watch on the `/admin` console while a player solves (events feed, integrity panel, hint dispatch).
3. **`02 - Submission Cheatsheet/Submission Cheatsheet.md`** — flag format, `POST /api/submit` shape, the `GET /api/me` dev shortcut. Every per-challenge MD links back here for the submit step.
4. **`1 - white-rabbit/` → `19 - hack-the-planet/`** — solve each challenge in order. Each folder has a single `<slug>.md` with steps; some folders also carry `tools/` with helper scripts.

Challenges are gated by per-player `current_ordinal` — you can only submit the flag for your *current* stage. Solving #N advances you to #N+1 transactionally.

---

## Index

| # | Slug | Title | Category | Pts | Surface | GIBSON |
|---|------|-------|----------|----:|---------|:------:|
| 1 | [white-rabbit](1%20-%20white-rabbit/white-rabbit.md) | Follow the white rabbit | Entry | 10 | `example.com` | — |
| 2 | [no-spoon](2%20-%20no-spoon/no-spoon.md) | There is no spoon | Entry | 10 | `hack.example.com` | — |
| 3 | [caesars-ghost](3%20-%20caesars-ghost/caesars-ghost.md) | Caesar's ghost | Crypto | 15 | `oracle.example.com` | — |
| 4 | [cookie-flip](4%20-%20cookie-flip/cookie-flip.md) | Zero Cool's cookie | Web | 20 | `zero.example.com` | — |
| 5 | [headers](5%20-%20headers/headers.md) | The headers don't lie | Web | 20 | `zero.example.com` | — |
| 6 | [dns-whispers](6%20-%20dns-whispers/dns-whispers.md) | DNS whispers | Net | 20 | `wopr.example.com` | — |
| 7 | [matryoshka](7%20-%20matryoshka/matryoshka.md) | Matryoshka | Crypto | 25 | `oracle.example.com` | **1/3** |
| 8 | [gibson-404](8%20-%20gibson-404/gibson-404.md) | Gibson's 404 | Web | 25 | `gibson.example.com` | — |
| 9 | [client-cinema](9%20-%20client-cinema/client-cinema.md) | Client-side cinema | Web | 30 | `zero.example.com` | — |
| 10 | [method-madness](10%20-%20method-madness/method-madness.md) | Method in the madness | Net | 30 | `wopr.example.com` | — |
| 11 | [regex-runes](11%20-%20regex-runes/regex-runes.md) | Regex runes | Logic | 30 | `oracle.example.com` | — |
| 12 | [xor-oracle](12%20-%20xor-oracle/xor-oracle.md) | XOR with the oracle | Crypto | 35 | `oracle.example.com` | — |
| 13 | [ports-of-call](13%20-%20ports-of-call/ports-of-call.md) | Ports of call | Net | 35 | `wopr.example.com` | **2/3** |
| 14 | [shall-we-play](14%20-%20shall-we-play/shall-we-play.md) | Shall we play a game? | Logic | 35 | `wopr.example.com` | — |
| 15 | [crack-wopr](15%20-%20crack-wopr/crack-wopr.md) | Crack the WOPR | Crypto | 40 | `wopr.example.com` | — |
| 16 | [git-archaeology](16%20-%20git-archaeology/git-archaeology.md) | Git archaeology | Logic | 40 | `hack.example.com` | — |
| 17 | [stego-static](17%20-%20stego-static/stego-static.md) | Stego in the static | Meta | 50 | `example.com` | **3/3** |
| 18 | [ghost-shell](18%20-%20ghost-shell/ghost-shell.md) | Ghost in the shell | OSINT | 50 | `mitnick.example.com` | — |
| 19 | [hack-the-planet](19%20-%20hack-the-planet/hack-the-planet.md) | Hack the planet | Final | 150 | `gibson.example.com` | uses 1+2+3 |

GIBSON key fragments surface in #7, #13, #17 as a 16-hex string each. **Write them down** — #19 needs all three concatenated as a 24-byte AES-192 key.

---

## Hosting modes (local vs subdomain)

Every challenge is reachable two ways:

- **Hub-routed** (works on any host): `http://localhost:3000/c/<ordinal>` and `/c/<ordinal>/<sub>`. The hub rewrites the URL so the handler sees the same shape it would on its subdomain. Use this for local dev.
- **Subdomain-routed**: `http://<subdomain>.example.com/`. Used in production. For local subdomain testing, add entries to `/etc/hosts` pointing each subdomain at `127.0.0.1` (see `00 - Setup/Setup.md`).

The per-challenge MDs use the hub-routed URLs by default (they work everywhere) and call out the subdomain form when it matters (e.g. challenge #10 needs methods other than GET, which `/c/10` doesn't accept).

---

## Phase cheatsheet

| Phase | Trigger | What players see |
|-------|---------|------------------|
| `uninitialized` | `launch_at` or `end_at` missing | "system offline" page |
| `prelaunch` | `now < launch_at` | Lobby + countdown to GIBSON GOES LIVE |
| `live` | `launch_at ≤ now < end_at` | Hub + 19-cell challenge grid |
| `frozen` | `now ≥ end_at` | Read-only leaderboard, GIBSON locked |

Set timestamps in `/admin/setup` → **Game timing**. Use `now − 1m` and `now + 24h` to land in `live` immediately. The `app_settings` cache TTL is 30 s, so wait a moment after saving.

---

## Anti-cheat warning

The submit endpoint detects flag-sharing. If you submit *another player's* flag (shape `ZERODAY{[A-F0-9]{24}}` but wrong-for-you), the server HMAC-scans every other user's flag for that challenge — if it finds a match, both you and the supplier eat strikes. Two strikes freezes both accounts.

Challenge #18 has the same pipeline for its per-player handle secret.

When testing with multiple players on the same DB, **don't** copy a flag from one player and paste it into another. If you need to recover, the admin console has two independent buttons in the player drawer's INTEGRITY panel: `unfreeze` and `clear-strikes`.

---

## Reset between runs

```bash
rm -f data/zeroday.db
npm run migrate     # rebuilds schema + seeds the 19 challenges
# admin password and all app_settings are gone — redo the 5-click bootstrap
```

The `flag_salt` is per-user, generated on signup. A wiped DB means new salts means new flags — fully isolated runs.
