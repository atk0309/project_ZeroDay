# Handoff Brief — Author the last two challenges (#16 git-archaeology, #18 ghost-shell)

> **Audience:** A fresh Claude Code session with no context from prior planning conversations. Read this end-to-end **before** opening any source file. The intent is that you have a clear list of decision points to surface to the user before starting #16, and again before starting #18.

---

## 0. Mission and recommended split

PR-C closes out the last two unauthored challenges and lights the credits:

| # | id | Category | Host | Points | Authoring difficulty |
|---|---|---|---|---|---|
| 16 | `git-archaeology` | Logic | `hack.example.com` | 40 | **Needs an out-of-band asset** — a real public GitHub repo seeded with secrets in its history |
| 18 | `ghost-shell` | OSINT | `mitnick.example.com` | 50 | **Needs design decisions** — what is the OSINT vector? Internal pivot vs external pretext page |

> Earlier scope of PR-C also included #19 hack-the-planet (the finale). That challenge **already shipped via PR #73** and is on `dev` — see `app/src/challenges/handlers/hack-the-planet.ts` for the most recently authored handler and the current house style.

### Strongly recommended: ship as two separate PRs

Each remaining challenge has a load-bearing user/ops decision (canonical seed repo URL for #16, OSINT vector for #18). Each section below lists the questions to surface to the user via `AskUserQuestion` before writing code. **Do not guess** — the answers determine what you build.

If you must do both in one PR, do them in the order #16 → #18, and pause for `AskUserQuestion` at the start of each new challenge.

---

## 1. Required reading, in this order

1. **`CLAUDE.md`** top to bottom. Invariants 1, 2, 3, 8 are load-bearing. The "What hasn't been built" list should currently say only "Challenges 16 and 18 use the stub handler."
2. **`docs/authoring-challenges.md`** — full how-to.
3. **`app/src/challenges/handlers/hack-the-planet.ts`** — the most recently authored handler (PR #73). Best reference for current house style, including the pure-function/route split that makes testing pleasant.
4. **`app/src/challenges/handlers/ports-of-call.ts`** — slightly older but a clean URL-state-machine example (single GET, query-string-encoded state). Both #16 and #18 will follow this shape.
5. **`app/src/challenges/registry.ts:14-34`** — confirm slugs, ordinals, hosts, point values verbatim.
6. **`app/src/server.ts:103-161`** — the host-based dispatcher. Critical for #18 because `mitnick.example.com` doesn't currently host any authored challenge; understanding the dispatcher tells you that **no infrastructure work is needed** to start using a new host — it's already in the registry, dispatch is automatic.
7. **`app/test/ports-of-call.test.ts`** — test shape to mirror.

---

## 2. Branch flow (do this first, every time)

```bash
git fetch origin dev
git checkout -b claude/<your-topic> origin/dev   # NOT off main, NOT off another claude/* branch
git rebase origin/dev                            # confirm clean baseline
npm ci
CHECK_BASE_SKIP=1 npm test                       # baseline must pass
npx tsc -p tsconfig.json --noEmit                # baseline must pass
```

PR-A (stego-static + GIBSON part 3), PR-B (#14 + #15), and PR-C-1 (#19) all merged into `dev` in earlier sessions. Inspect `app/src/challenges/handlers/index.ts` on `origin/dev` — the `authored` map should already include `'shall-we-play'`, `'crack-wopr'`, `'stego-static'`, and `'hack-the-planet'`. If anything is missing, **stop and ask the user** before proceeding; you may be on a stale base.

---

## 3. Challenge #16 — Git archaeology

### Theme

A leak in plain sight — an internal repo accidentally pushed public; the secret is in a commit that was later "fixed" but never `git push --force`d. Player uses git history tooling (`git log`, `git log -p`, `git reflog`, `git log -- <deleted-path>`) to find it.

### Hard prerequisite — surface to user before authoring

**You need a real, reachable, public git repository with the planted secret in its history.** This is an out-of-band ops decision, not a code decision.

Surface to the user via `AskUserQuestion` before any code:

> "For challenge #16 (git-archaeology), I need a public git repo to reference. Three options:
> 1. **Use an existing repo we control** — e.g. a sibling of atk0309/project_zeroday with a planted secret in old commits. (You provide the URL + secret string.)
> 2. **Create a new public seed repo now** — I'll script the commit history (`git init` → commit benign → commit with secret → commit "fix: remove secret" without `--force`-removing the blob) and you push it. (You provide the repo name; I prepare the script.)
> 3. **Embed the puzzle entirely in-process** — serve a tarball of a synthetic `.git` directory from the handler. No external repo, but loses the 'go look on GitHub' charm.
>
> Which?"

Default if the user is indifferent: option 2 — most authentic to the theme, controllable, and the seed script lives in `tools/git-seed.sh` (or similar) for repeatability.

### Mechanic (sketch — refine after the user answers)

- Landing on `hack.example.com`: render an in-voice clue page pointing the player at the public repo URL ("our researchers found this last week. somebody's still listening.") and a search box.
- Player goes to GitHub, runs git history archaeology, finds the secret string (say `ZERODAY_DEPLOY_KEY=hxV9qZ...` in an old commit).
- Player submits the secret string back via `?secret=<value>` on the landing.
- On canonical match, render the per-player flag in a CRT-styled "you're a real one" block.

### Per-player flag pattern

Same as PR-B's #15 — the **secret in the repo is canonical** (one shared answer); the **per-player flag** is the reward the handler renders on canonical-secret-match. This keeps the puzzle hint-aware ("the secret is in the third-to-last commit on `main`") while still gating advancement on user salt.

### Files (after user answers)

- Create: `app/src/challenges/handlers/git-archaeology.ts`
- Create: `app/test/git-archaeology.test.ts`
- Possibly create: `tools/git-seed.sh` (only if option 2 above)
- Modify: `app/src/challenges/handlers/index.ts`
- Doc pass on the same surfaces as the other authored handlers

### Decisions to surface (in addition to the seed-repo question above)

- **Hash the canonical secret in source, or store plaintext?** Canonical answer is `?secret=<exact-string>`; the handler compares against the canonical. If the handler stores the plaintext secret as a constant in `git-archaeology.ts`, anyone reading the public source code can solve without doing the puzzle. **Recommendation**: store SHA-256 of the secret as the constant; compare via `crypto.timingSafeEqual` of the digests. Confirm with user that they want this guard.

---

## 4. Challenge #18 — Ghost in the shell

### Theme

Mitnick-flavored social engineering. The player has to find a piece of information that wasn't supposed to be public.

### Hard prerequisite — surface to user before authoring

`mitnick.example.com` is the assigned host. **Critically, no infrastructure work is required** — `app/src/server.ts` dispatches by host string, and the registry already lists `mitnick.example.com` for #18. Authoring the handler is sufficient. The Caddyfile under `ops/` should already have a wildcard or explicit entry; confirm by reading `ops/Caddyfile` before assuming.

What you DO need from the user is the OSINT vector. Surface via `AskUserQuestion` before any code:

> "For challenge #18 (ghost-shell, OSINT) on mitnick.example.com, three vector options:
> 1. **Internal pivot** — the answer is hidden somewhere in the existing site/admin/recruit content (e.g. an EXIF GPS tag on a placeholder image, a username in a CSS comment, a phone number in `web/views/admin/_topbar.ejs`'s contact line). Self-contained; no external infra. Mitnick's vibe is 'they were already in your building'.
> 2. **External pretext page** — a fake LinkedIn/Twitter/Mastodon profile hosted on the same site at a non-obvious path (or a separate static page on `mitnick.example.com`). The profile contains the secret in a bio/pinned-post/photo-caption. More authentic OSINT, more flavor work.
> 3. **Hybrid** — landing on `mitnick.example.com` says 'find me'. Player has to discover an internal page they already have access to (e.g. `mitnick.example.com/staff` or a hidden `robots.txt` disallow) that doxes a fake employee with the secret.
>
> Which? And what's the secret string the player ultimately submits?"

Default if the user is indifferent: option 1 (internal pivot) — lowest authoring overhead, doesn't require maintaining an external pretext, easy to make Mitnick-flavored.

### Mechanic (sketch — refine after the user answers)

- Landing: render an in-voice prompt that names what to find without naming where ("there's a name we don't want anyone saying. say it.") plus a single text input.
- Player pivots through the site, finds the planted secret, submits via `?find=<value>`.
- On canonical match, render the per-player flag.

### Per-player flag pattern

Same as #16 — canonical secret triggers the per-player flag rendering.

### Files (after user answers)

- Create: `app/src/challenges/handlers/ghost-shell.ts`
- Create: `app/test/ghost-shell.test.ts`
- Possibly modify: existing view files (`web/views/admin/_topbar.ejs` etc.) to plant the breadcrumb if option 1.
- Modify: `app/src/challenges/handlers/index.ts`
- Doc pass

### Decisions to surface

In addition to vector + secret string above:

- **Is the planted breadcrumb visible to all players, or only to ordinal-18 players?** Recommendation: visible to all (cheaper to maintain, increases the "they were always there" charm). A pre-ordinal-18 player who notices it can't yet submit because the ordinal gate still applies.

---

## 5. House conventions you must honor

- ES modules; TS imports use `.js` extensions (`moduleResolution: "bundler"`).
- Top-level `db.prepare(...)` runs at import time — schema must be applied before the handler module loads. **Don't touch the DB at module load** unless you have a reason; both #16 and #18 above stay stateless.
- No template-string SQL.
- Comments favor the WHY, not the what. Match the tone of `ports-of-call.ts:1–15` and `hack-the-planet.ts`.
- CRT aesthetic: lowercased, terse, period-end-of-line, no emoji, reference the legends. See the bottom of `docs/authoring-challenges.md`.
- Inline `escapeHtml` per-handler — house style.
- `page()` receives `{ user, flag }`; the `flag` is already prepared for this user. Don't call `generateFlag` yourself.

---

## 6. Test conventions (mirror the existing authored handlers)

For each challenge, ship at minimum:

1. Pure-function tests for any state evaluator you split out.
2. Landing render with no flag in body.
3. Solve render with per-player flag in body.
4. Wrong-input render with no flag in body.
5. Subdomain-dispatch parity test (host header instead of `/c/N`).
6. Per-player isolation test (two users → distinct flags, no cross-leak).

Test setup boilerplate (`applySchema`, `settings.setMany({launch_at, end_at})`, `skipTo`, `findOrCreateUser`, `createSession`) is identical to `app/test/ports-of-call.test.ts`. Copy verbatim.

---

## 7. Documentation pass (mandatory, per CLAUDE.md)

For each challenge you ship, walk this checklist:

- New table / column / migration → "Schema gotchas" in `CLAUDE.md`. Neither #16 nor #18 adds one — confirm and move on.
- New `app_settings` key → `lib/settings.ts:SettingKey`. None — confirm.
- New invariant → "Invariants" in `CLAUDE.md`. None expected.
- New audit-log action / event kind → vocabulary lists in `CLAUDE.md`. None expected.
- New top-level workflow / branch convention → "Branch flow" in `CLAUDE.md`. None.
- **`CLAUDE.md` "What hasn't been built"**: drop the challenge from the stub-list line. After both ship, the line should disappear entirely (or read "All 19 challenges are authored").
- **`README.md` Status table**: bump "Authored challenges" count.
- **`docs/authoring-challenges.md`**: no expected changes for these two — neither introduces a new pattern.

State doc impact in the PR body. If no doc change is needed, write `Docs: no impact (internal refactor)` — never silently skip.

---

## 8. Verification per challenge

```bash
npx tsc -p tsconfig.json --noEmit            # must pass
CHECK_BASE_SKIP=1 npm test                   # full suite must pass
npm run dev                                   # then manual playthrough below
```

Manual playthrough (after each challenge):

1. Sign up via `/recruit`, capture magic-link from server logs.
2. As admin, set `launch_at` in the past via `/admin/setup`.
3. Admin-skip the player to the target ordinal.
4. Visit `/c/<ordinal>`, solve, submit, confirm `current_ordinal` advances.

---

## 9. Out of scope

- Any rebalance of `HINT_COSTS`, per-challenge `points`, or the registry.
- Changes to the cheat-detect / strike machinery.
- Changes to mail templates, recruit copy, or admin views beyond what #18 might require for breadcrumbs.
- Closing `/recruit` to invite-only (a separate, deliberate later PR).
- Cohort matrix view in admin.

---

## 10. Commit + push convention

One commit per challenge (or one for the whole PR if you ship them together — your call, but separate commits are easier to revert). Conventional Commits subject; body explains the WHY and lists doc impact:

```
feat(challenges): author #16 git-archaeology

Logic puzzle on hack.example.com. Player follows the in-voice clue to a
seeded public GitHub repo, runs `git log -p` (or similar) over the
history, finds the planted secret in an old commit, submits the secret
via ?secret=<value>. Server compares the SHA-256 of the submitted value
against a canonical digest constant (timing-safe), then renders the
per-player flag on match.

Same per-player-flag pattern as #15 crack-wopr — canonical secret gates
canonical-flag rendering; per-user salt still owns the actual flag.

Seed-repo script committed at tools/git-seed.sh; run once at authoring
time to bootstrap the public repo's history.

Docs: CLAUDE.md "What hasn't been built", README.md status table.
```

Push to `origin` with `-u`. **Do not** open a pull request unless the user explicitly asks (the `claude-code` instruction is firm).

---

## 11. Order of attack — the quickest path to "all 19 authored"

1. **PR-C-2: #16.** Surface the seed-repo decision. Wait for the user. Build it.
2. **PR-C-3: #18.** Surface the OSINT-vector decision. Wait for the user. Build it.

After PR-C-3 lands: `CLAUDE.md` "What hasn't been built" loses the entire "Challenges N, M use the stub handler" line. `authoredChallengeIds()` returns all 19. The stub handler stays as the engine fallback (it's a safety net, not a TODO).

---

## 12. If anything in this brief contradicts what you find in `CLAUDE.md` or the existing handlers

`CLAUDE.md` and the actual code win. PR-A, PR-B, and PR-C-1 (#19) have all landed since this brief was originally drafted; if a section refers to work that is already done on `origin/dev`, treat it as historical context and trust the codebase. If you spot a contradiction (e.g. a new invariant landed, a route signature changed, the GIBSON key constants moved), follow the codebase and note the divergence in your PR body.
