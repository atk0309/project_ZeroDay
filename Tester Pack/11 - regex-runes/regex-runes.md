# 11 — Regex runes

- **Slug:** `regex-runes`
- **Category:** Logic · **Points:** 30
- **Surface:** `oracle.example.com` (or `/c/11` from hub)
- **GIBSON key part:** —

## Premise

Two columns: **BLESSED** (must match) and **CURSED** (must not match). Submit a regex via `?pattern=`. The oracle reveals the flag iff every blessed rune matches and zero cursed runes do.

## What you need

- Regex literacy. That's it.

## Step-by-step solve

1. Visit `http://localhost:3000/c/11`. The columns are:
   - **BLESSED**: `CAFE`, `DEAD`, `BEEF`, `FACE`, `CEDE`, `FADE`
   - **CURSED**: `C0DE`, `1337`, `ABBAB`, `C1A0`, `DECAF`, `CFCFCF`
2. Patterns to notice:
   - All BLESSED are exactly 4 chars.
   - All BLESSED contain only `[A-F]`.
   - CURSED violations: `C0DE`/`C1A0` have digits, `1337` is all digits, `DECAF`/`ABBAB` are 5 chars, `CFCFCF` is 6 chars.
3. Pattern that covers both constraints: `^[A-F]{4}$`.
4. Submit:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/11?pattern=^[A-F]{4}$'
   ```
5. Response: "the oracle concedes." + the flag.

### Alternative patterns that also work

- Literal alternation: `^(CAFE|DEAD|BEEF|FACE|CEDE|FADE)$`
- Pattern length cap is 96 chars; long alternations are fine.

### URL encoding

The browser handles `^[A-F]{4}$` fine. If using curl, the shell may need `'...'` quoting (single quotes prevent `$` expansion).

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"regex-runes","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Forgetting anchors** — `[A-F]{4}` (no `^`/`$`) matches inside longer cursed strings like `DECAF` (catches `DECA`). Use `^...$`.
- **Submitting an empty pattern** — returns `the oracle awaits a pattern. silence is no answer.`
- **Patterns over 96 chars** — rejected with `the oracle does not entertain incantations longer than 96 runes.`

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=12`.
