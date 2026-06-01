# 1 — Follow the white rabbit

- **Slug:** `white-rabbit`
- **Category:** Entry · **Points:** 10
- **Surface:** `example.com` (or `/c/1` from hub)
- **GIBSON key part:** —

## Premise

A corporate-front landing page for a fake "ZeroDay Ltd. boutique consultancy". Looks deliberately mundane. The flag isn't on this page — but breadcrumbs are. Multiple ones, all redundant.

## What you need

- Browser with view-source / DevTools.
- Base64 decoder (browser console or any online tool).

## Step-by-step solve

There are at least four breadcrumbs that all point at the same place: `/matrix`. Use any one of them.

### Path A — DevTools console (canonical)

1. Open `http://localhost:3000/c/1` (or `http://example.com:3000/` if subdomain routing is set up).
2. Open DevTools → Console.
3. You'll see three log lines, the middle one is a colored block of base64. Copy that base64 string.
4. Decode it (browser console works):
   ```js
   atob("d2VsY29tZSwg...")
   ```
5. It decodes to: `welcome, operator. follow the white rabbit -> /matrix\n     if you are expected, you will have a token.`

### Path B — view-source

1. Right-click → View Source.
2. On line 23 there's an HTML comment: `<!-- TODO(m): kill this before launch. recruit URL is /recruit?token=<see #matrix>. --m -->`. (In-fiction author flavor — a "developer left a TODO" breadcrumb.)
3. Same hint, different surface: visit `/matrix`.

### Path C — `/robots.txt`

1. `curl http://localhost:3000/c/1/robots.txt`
2. Body: `User-agent: *\nDisallow: /matrix\n`. The disallowed path is the puzzle.

### Path D — hover the period

1. The footer ends with a tiny `.` after "Co. No. 09472341." Hover it. A green CRT toast pops up: "click the period or check your console or check `/matrix`".

### Then in any case

5. Visit `http://localhost:3000/c/1/matrix` (or `http://example.com:3000/matrix`).
6. The page renders:
   ```
   the matrix has you.
   ZERODAY{XXXXXXXXXXXXXXXXXXXXXXXX}
   memorize it. submit it on hack.example.com.
   ```
7. Copy the flag. Submit.

## Submit

Use the [Submission Cheatsheet](../02%20-%20Submission%20Cheatsheet/Submission%20Cheatsheet.md). Quick version:

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"white-rabbit","flag":"ZERODAY{...}"}'
```

Expected response: `{ "correct": true, "advanced": true, "completed": false, "next": 2 }`.

## Common failure modes

- **Submitting on `example.com` host instead of the hub** — flag form lives at the hub (`/`), not on the puzzle subdomain. Once you have the flag, switch back to your hub origin to submit.
- **Hitting `/matrix` before reaching `/c/1`** — the host dispatcher rejects unauthenticated subdomain access in some phases. Make sure you're at `current_ordinal=1` first.
- **403 `not your current stage`** — you're past challenge 1. Hit `GET /api/me` to confirm.

## Verification (admin side)

In `/admin`, the live feed should show a `solve` event with `payload.challenge_id="white-rabbit"`. The player drawer should show `current_ordinal=2`, `solves=1`, last attempt = the correct flag.
