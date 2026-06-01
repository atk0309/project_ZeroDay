# 13 — Ports of call

- **Slug:** `ports-of-call`
- **Category:** Net · **Points:** 35
- **Surface:** `wopr.example.com` (or `/c/13` from hub)
- **GIBSON key part:** **2 of 3**

## Premise

WOPR-themed port-knocking. Three "open lines" with cryptic clues. Dial them in **exact order** via `?dial=A,B,C`.

## What you need

- A browser, OR `curl`.
- Hacker-lore knowledge (or web search).

## Step-by-step solve

1. Visit `http://localhost:3000/c/13`. The three clues:
   1. **"the cereal box whistle. blue boxes were born from this frequency."**
   2. **"the fourth perfect number. take the one closest to ten thousand."**
   3. **"if leet is 1337, this is leet to the elite. five digits."**

2. Decode each:
   - **Line 1**: 2600 Hz — Cap'n Crunch's whistle, the foundational phreaking frequency.
   - **Line 2**: 8128. Perfect numbers are 6, 28, 496, **8128**, 33550336, … The fourth, closest to 10 000.
   - **Line 3**: 31337. "Eleet" is leetspeak's "elite" form (one extra digit beyond 1337).

3. Dial them in order:
   ```
   http://localhost:3000/c/13?dial=2600,8128,31337
   ```
   Or:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/13?dial=2600,8128,31337'
   ```

4. Response includes:
   - Body line: "lines acquired in sequence. handshake complete." + `ZERODAY{...}` flag.
   - **GIBSON key fragment 2** rendered in a styled block: 16 hex chars (e.g. `9E7B5C3A11D22F08`).

5. Submit the flag. **Save the GIBSON fragment** for challenge #19.

### Failure modes from the handler

- `?dial=2600,8128` (wrong count) → `wrong order, wrong number, or both.`
- `?dial=8128,2600,31337` (wrong order) → same.
- `?dial=abc,def,ghi` → `dial garbled. comma-separated digits only.`

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"ports-of-call","flag":"ZERODAY{...}"}'
```

## GIBSON key fragment

Format: 16 hex chars. **Save it.** Combined with parts 1 (#7) and 3 (#17), this forms the 24-byte AES-192 key for challenge #19.

## Common failure modes

- **Including spaces** (`2600, 8128, 31337`) — the `evaluateDial` regex tolerates leading/trailing whitespace but the comma-separated split is strict on digits-only. Try without spaces if it errors.
- **Picking the wrong perfect number** — second perfect (28), third (496), and fifth (33 550 336) all fail. The clue says "closest to ten thousand" — that's 8128.
- **Confusing 1337 with 31337** — 1337 alone doesn't work. The clue says "leet to the **elite**, five digits".

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=14`.
