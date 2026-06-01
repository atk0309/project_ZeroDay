# 16 — Git archaeology

- **Slug:** `git-archaeology`
- **Category:** Logic · **Points:** 40
- **Surface:** `hack.example.com` (or `/c/16` from hub)
- **GIBSON key part:** —

## Premise

An internal repo got pushed public. An engineer "fixed" the embedded credential in a follow-up commit but never force-pushed. The leaked line is still in history. Find it.

## What you need

- `git` CLI.
- Internet (the seed repo is hosted on GitHub).

## Step-by-step solve

1. Visit `http://localhost:3000/c/16`. The page shows a link to `https://github.com/atk0309/ZeroDay-internal` and a tooling cheat-sheet.
2. Clone the repo:
   ```bash
   git clone https://github.com/atk0309/ZeroDay-internal /tmp/ZeroDay-internal
   cd /tmp/ZeroDay-internal
   ```
3. Read the commit history for `deploy.sh`:
   ```bash
   git log --oneline -- deploy.sh
   git log -p -- deploy.sh
   ```
4. There are three commits touching `deploy.sh`. The middle one introduces a credential; a later commit removes it. The introduced line:
   ```
   ZERODAY_DEPLOY_KEY=hxV9qZ7rB3kPmN2sLfJtXcWy
   ```
5. Copy that **exact** string (including `ZERODAY_DEPLOY_KEY=`).
6. Submit it via the form, or directly:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/16?secret=ZERODAY_DEPLOY_KEY=hxV9qZ7rB3kPmN2sLfJtXcWy'
   ```
7. Response: "trace confirmed. you read history like a ghost." + `ZERODAY{...}`.

The server stores only `sha256(secret)` and uses `timingSafeEqual`. Copy the full line exactly — leading/trailing spaces or a missing `=` will fail.

### Alternative archaeology commands

```bash
# What did old commits look like?
git log --all --oneline

# Was the line ever in any blob?
git rev-list --all | xargs git grep "ZERODAY_DEPLOY_KEY"

# What did one specific commit change?
git show <sha>
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"git-archaeology","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Submitting just the value, not the full line** — the planted line is `ZERODAY_DEPLOY_KEY=hxV9qZ7rB3kPmN2sLfJtXcWy`. Submit it whole.
- **Cloning shallow** (`--depth=1`) — strips history. Don't.
- **Forking a private operator deployment** — the embedded digest in `git-archaeology.ts` is for the public seed repo (`atk0309/ZeroDay-internal`). Custom deployments need to regenerate the digest with their own seed; see `tools/git-seed.sh`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=17`.
