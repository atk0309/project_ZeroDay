# 5 — The headers don't lie

- **Slug:** `headers`
- **Category:** Web · **Points:** 20
- **Surface:** `zero.example.com` (or `/c/5` from hub)
- **GIBSON key part:** —

## Premise

The vestibule only opens for visitors whose `User-Agent` contains `acid-burn` (case-insensitive). Vanilla browsers see "i don't know you" + a hint header.

## What you need

- `curl` (browsers don't reliably let you spoof User-Agent without an extension).

## Step-by-step solve

1. Vanilla request — see the rejection:
   ```bash
   curl -i -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/c/5
   ```
2. Look at the response headers:
   ```
   X-Gibson-Hint: identity unverified - acid burn makes the cinema bow
   ```
3. Body says: "(maybe the gate is reading more than your URL.)" — confirming the User-Agent angle.
4. Retry with the right UA:
   ```bash
   curl -i -A "acid-burn" -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/c/5
   ```
5. Two places where the flag lands:
   - **Response header**: `X-Gibson-Access: ZERODAY{...}` — easiest to grep.
   - **HTML body**: `<span class="flag">ZERODAY{...}</span>`.
6. Either works. The match is `ua.toLowerCase().includes('acid-burn')`, so `Acid-Burn`, `mozilla acid-burn 1.0`, `crash-override-and-acid-burn` all pass.

### One-liner that scrapes the header

```bash
curl -s -I -A "acid-burn" -b "PLAYER_COOKIE=<your-cookie>" \
  http://localhost:3000/c/5 | grep -i x-gibson-access
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"headers","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Browser-side User-Agent spoof not working** — Chrome's network conditions panel can change the UA, but extensions are flaky. `curl -A` is the reliable path.
- **Missing the cookie on the curl call** — without `PLAYER_COOKIE` you'll be redirected to `/recruit` before the handler runs.
- **Case sensitivity worry** — there is none. The check is `.toLowerCase().includes('acid-burn')`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=6`.
