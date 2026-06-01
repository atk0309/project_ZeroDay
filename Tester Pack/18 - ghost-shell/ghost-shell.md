# 18 — Ghost in the shell

- **Slug:** `ghost-shell`
- **Category:** OSINT · **Points:** 50
- **Surface:** `mitnick.example.com` (or `/c/18` from hub)
- **GIBSON key part:** —

## Premise

A Mitnick-flavored social-engineering pivot. The landing names the goal without naming the where: "there's a name we don't want anyone saying. say it." The breadcrumb is a `/robots.txt` Disallow pointing at `/staff` — a fake operative roster. Eight rows are decoys (identical for every player); one row is **your** personal target. Visible row text is `[REDACTED]`. The leak is in HTML source.

⚠ **Do not submit another player's secret.** The handler runs `detectGhostSupplier()` on wrong submissions; matching another op's secret triggers the **same** two-strike cheat pipeline as flag-sharing. Both you and the supplier eat strikes. Recovery: admin-side `unfreeze` + `clear-strikes`.

## What you need

- Browser with view-source.

## Step-by-step solve

1. Visit `http://localhost:3000/c/18`. Landing page tells you to find a name and submit it. Hint: "robots are honest about what they're hiding."
2. Check `/robots.txt`:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/c/18/robots.txt
   # User-agent: *
   # Disallow: /staff
   ```
3. The disallowed path is the puzzle. Visit it: `http://localhost:3000/c/18/staff`.
4. The page renders a 9-row staff directory. Every row's name reads `[REDACTED]`. Every row has an avatar.
5. View source (or Elements panel) and search for `alt=`.
6. Eight rows have `alt="[REDACTED]"`. **One row has a real handle**, like:
   ```html
   <img src="..." alt="acidburn-238467" data-emp-id="238467">
   ```
7. The format is `<handle>-<NNNNNN>` (lowercase handle, hyphen, 6 digits). That's your secret.
8. Submit it via the form, or directly:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/18/staff?find=acidburn-238467'
   ```
   Or on the landing page (`?find=` works there too).
9. Response: "kevin nods. you read the room." + `ZERODAY{...}`.

The leak is **per-player**. Tester A's `acidburn-238467` is Tester B's `crashoverride-451220`. The slot index in the table also varies (= suffix mod 9), so positional inference is harder.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"ghost-shell","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Submitting another tester's handle** — triggers the strike pipeline. Recovery via admin `/admin/api/player/:id/unfreeze` + `/admin/api/player/:id/clear-strikes`.
- **Reading rendered text instead of source** — every visible name says `[REDACTED]`. View-source / Elements panel is the only path.
- **Looking at `data-emp-id` instead of `alt`** — `data-emp-id` on decoys is a stable hash-like number; on your row it's the suffix only. The full secret (`<handle>-<NNNNNN>`) is in the `alt` attribute.
- **Case mismatch on submit** — the handler lowercases input via `submitted.trim().toLowerCase()`. `AcidBurn-238467` works the same as `acidburn-238467`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=19`.

If you triggered the cheat path on purpose, watch for `cheat_detected` in the live feed and check the player's INTEGRITY panel.
