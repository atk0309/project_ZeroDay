# 9 — Client-side cinema

- **Slug:** `client-cinema`
- **Category:** Web · **Points:** 30
- **Surface:** `zero.example.com` (or `/c/9` from hub)
- **GIBSON key part:** —

## Premise

A 12-second CSS keyframe animation cycles a canvas reveal. The flag is drawn for ~1 % of the cycle (one frame out of ~720 at 60 fps), invisible to casual viewing. Pause the animation and the flag is right there.

## What you need

- Browser DevTools with the **Animations** panel (Chrome/Edge/Firefox all have it).

## Step-by-step solve

1. Visit `http://localhost:3000/c/9`. You see a black bordered stage with what looks like an empty area. ("the projector hums. a frame slips past every twelve seconds.")
2. There are three solve methods — pick whichever is fastest.

### Method A — pause `animation-play-state` (fastest)

1. Open DevTools → Elements panel.
2. Find `<canvas id="reel">`.
3. In the Styles pane on the right, find the `canvas` rule with `animation: reveal 12s linear infinite`.
4. Add `animation-play-state: paused` to that rule.
5. Reload. The flag is drawn at the start of the next iteration and stays visible.

Doesn't work? Use Method B.

### Method B — Animations panel

1. DevTools → More tools → Animations panel.
2. Trigger the animation (refresh the page once with the panel open).
3. The `reveal` keyframe shows as a horizontal bar.
4. Drag the playhead toward the right edge (~99 %).
5. The canvas snaps to the visible state with the flag drawn.

### Method C — read the data attribute

The flag is in the canvas's `data-flag` attribute too — the JS pulls it from there to paint:

1. DevTools → Elements panel.
2. Click `<canvas id="reel" data-flag="ZERODAY{...}" ...>`.
3. Read the `data-flag` value directly.

(Yes, this skips the puzzle. It works because the flag has to reach the JS somehow.)

3. Once you have the flag, submit.

### Bonus header

`curl -I` on the page returns `X-Cinema-Hint: pause-on-frame` — a nudge for CLI users.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"client-cinema","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Recording video to capture the visible frame** — works but unnecessary. Pausing the animation is faster.
- **Looking at the rendered DOM and seeing nothing** — the canvas is `opacity: 0` for 99 % of the cycle. Pause first.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=10`.
