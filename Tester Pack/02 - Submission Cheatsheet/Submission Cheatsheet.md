# 02 — Submission Cheatsheet

Reference for submitting flags. Linked from every per-challenge MD.

---

## Flag format

Per-player, derived as `HMAC-SHA256(key=FLAG_SECRET, message=flag_salt || '|' || challenge_id)`, truncated to the first 24 hex chars, uppercased, and wrapped:

```
ZERODAY{[A-F0-9]{24}}
```

Case-**sensitive** on the wire. `verifyFlag` (`app/src/lib/flags.ts`) trims whitespace then `timingSafeEqual`s byte-for-byte against the uppercase-hex expected value, so `zeroday{...}` or mixed-case hex are rejected. Two players never share a flag for the same challenge — that's the entire anti-cheat story.

---

## `POST /api/submit`

```http
POST /api/submit HTTP/1.1
Host: localhost:3000
Content-Type: application/json
Cookie: PLAYER_COOKIE=<your-session-value>

{
  "challenge_id": "white-rabbit",
  "flag": "ZERODAY{ABCDEF0123456789ABCDEF01}"
}
```

### Response codes

| Status | Body | When |
|-------:|------|------|
| 200 | `{ "correct": true, "advanced": true, "completed": false, "next": 2 }` | Flag matches, your ordinal advanced. |
| 200 | `{ "correct": false }` | Wrong flag, not a known supplier. Honest miss — `attempts` row inserted. |
| 200 | `{ "correct": false, "cheat": { "detected": true, "supplier_alias": "...", "strike_number": 1, "supplier_frozen": false } }` | Submitted flag is *another player's* flag. Strike fired. Your next HTML request bounces you to `/frozen`. |
| 400 | `{ "error": "missing challenge_id or flag" }` | Body schema invalid. |
| 403 | `{ "error": "not your current stage", "current": N }` | You tried to submit for ordinal ≠ your `current_ordinal`. Submitted *before* the flag is verified — no leak about whether your guess was right. |
| 404 | `{ "error": "unknown challenge" }` | `challenge_id` not in registry. |
| 423 | `{ "error": "transmission window closed" }` | Phase is `uninitialized` or `prelaunch`. |
| 423 | `{ "error": "transmission ended" }` | Phase is `frozen`. |

### curl one-liner

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"white-rabbit","flag":"ZERODAY{...}"}'
```

---

## `GET /api/me` — the dev shortcut

In `NODE_ENV=development`, this endpoint returns your current state **and the expected flag for your current challenge**:

```bash
curl -b "PLAYER_COOKIE=<your-cookie>" http://localhost:3000/api/me
```

```json
{
  "alias": "neo",
  "current_ordinal": 1,
  "current_challenge_id": "white-rabbit",
  "completed": false,
  "_expected_flag_preview": "ZERODAY{ABCDEF0123456789ABCDEF01}"
}
```

Use this to:
- Verify your solve is correct *before* hitting submit.
- Skip a challenge entirely if you're stuck on the puzzle but want to advance through the game.
- Confirm the per-player flag system is working (each user gets a different value).

`_expected_flag_preview` is only present when `NODE_ENV=development`. In production it's `undefined` and not serialized.

---

## Capturing your `PLAYER_COOKIE`

After the magic-link redirect lands you on `/`:

1. DevTools → Application tab → Cookies → `http://localhost:3000`.
2. Find row `PLAYER_COOKIE`.
3. Copy the **Value** column.

That's your session. It's `httpOnly`, signed, and `SameSite=Lax`. It expires in 30 days.

For long curl sessions, save it once:
```bash
export ZD_COOKIE="$(read -sp 'paste cookie: ' c && echo $c)"
curl -b "PLAYER_COOKIE=$ZD_COOKIE" http://localhost:3000/api/me
```

---

## Sequential gating

You cannot submit out of order. The submit route validates `current_ordinal == challenge.ordinal` **before** verifying the flag, so a wrong guess for a future challenge gets the same 403 as a correct guess for that future challenge — no information leak.

To unstick yourself:
- Solve the current ordinal.
- Or: open `/admin`, find your player row, click `[ skip ]` (logs `admin_skip` + `⚠` mark on the cell).
- Or: hit `POST /admin/api/player/:id/skip` directly with an admin session.

---

## Anti-cheat shape gate

`detectFlagSupplier()` runs only on submitted strings matching `/^ZERODAY\{[A-F0-9]{24}\}$/`. Random garbage never triggers the HMAC scan; the strike pipeline only fires when you submit a **shape-valid** flag that happens to belong to *another player*.

If you're testing strike behavior on purpose (multi-player run on the same DB), the shape filter means typos like `ZERODAY{xxx}` will fail with `correct: false` — you need to copy a real flag from another user to trigger the cheat path.

Recovery is two clicks in the admin player drawer's INTEGRITY panel: `unfreeze` and `clear-strikes`.
