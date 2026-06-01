# 8 — Gibson's 404

- **Slug:** `gibson-404`
- **Category:** Web · **Points:** 25
- **Surface:** `gibson.example.com` (or `/c/8` from hub)
- **GIBSON key part:** —

## Premise

Most paths return a styled 404. The 404 has an HTML comment carrying a base64 hint pointing at `/robots.txt`. Robots lists two paths — one is a decoy, one is real.

## What you need

- Browser with view-source.
- Base64 decoder.

## Step-by-step solve

1. Visit `http://localhost:3000/c/8`. You get a 404 page styled in green CRT. ("the gibson does not know this room.")
2. View source. Inside the `<head>` there's an HTML comment:
   ```html
   <!-- eyJoaW50IjoiY2hlY2sgeW91ciByb2JvdHMudHh0In0= -->
   ```
3. Decode the base64:
   ```
   {"hint":"check your robots.txt"}
   ```
4. Visit `http://localhost:3000/c/8/robots.txt`:
   ```
   User-agent: *
   Disallow: /sys/diag
   Disallow: /sys/console
   ```
5. Two paths listed. One is the decoy, one is the prize.
6. Try the decoy first:
   ```bash
   curl -i -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/c/8/sys/diag
   ```
   404. ("nothing here. keep digging.")
7. Try the real one:
   ```bash
   curl -i -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/c/8/sys/console
   ```
8. 200 OK. The flag lands in two places:
   - **Response header**: `X-Gibson-Bypass: ZERODAY{...}`
   - **HTML body**: `<span class="flag">ZERODAY{...}</span>`

### One-liner that grabs the header

```bash
curl -s -I -b "PLAYER_COOKIE=<your-cookie>" \
  http://localhost:3000/c/8/sys/console | grep -i x-gibson-bypass
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"gibson-404","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Trying `/sys/diag` and giving up** — robots.txt lists *both* candidates. Try them both.
- **Skipping the base64 decode** — the literal comment is base64. It's not a coincidence; the comment teaches "look for hints in unusual places".
- **Trying paths not in robots.txt** — there are no other secret paths. The two listed are the entire search space.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=9`.
