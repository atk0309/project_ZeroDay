# 6 — DNS whispers

- **Slug:** `dns-whispers`
- **Category:** Net · **Points:** 20
- **Surface:** `wopr.example.com` (or `/c/6` from hub)
- **GIBSON key part:** —

## Premise

A simulated `dig` tool. Most queries return NXDOMAIN. Three TXT records exist on the `wopr.example.com` zone. Two are visible nudges; one is the flag.

## What you need

- A browser, OR `curl`.

## Step-by-step solve

1. Visit `http://localhost:3000/c/6`. The page hints at two example records:
   - `_motd.wopr.example.com`
   - `_operator.wopr.example.com`
2. Try them:
   - `_motd` → `"war games. the only winning move is not to play."`
   - `_operator` → `"phone the operator. the line is hot but quiet. mind the underscores."`
3. The hint is **underscores**. There's a third record at `_secret.wopr.example.com`.
4. Query it via the form, or directly:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/6?name=_secret.wopr.example.com'
   ```
5. Response:
   ```
   ;; ANSWER SECTION:
   _secret.wopr.example.com.   300   IN   TXT   "ZERODAY{...}"
   ```
6. Strip the surrounding quotes. That's your flag.

The query is normalized: trimmed, lowercased, trailing `.` stripped. So `_SECRET.WOPR.EXAMPLE.COM.` works the same.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"dns-whispers","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Querying without the underscore prefix** — `secret.wopr.example.com` returns NXDOMAIN. The convention from `_motd`/`_operator` is the breadcrumb.
- **Querying a different zone** — only `wopr.example.com` records exist. `_secret.example.com` returns NXDOMAIN.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=7`.
