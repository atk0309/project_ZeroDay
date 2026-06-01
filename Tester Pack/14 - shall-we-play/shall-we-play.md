# 14 — Shall we play a game?

- **Slug:** `shall-we-play`
- **Category:** Logic · **Points:** 35
- **Surface:** `wopr.example.com` (or `/c/14` from hub)
- **GIBSON key part:** —

## Premise

The WOPR offers a menu of games. The puzzle is the canonical *WarGames* (1983) line:

> "A strange game. The only winning move is not to play."

The solve: **select Global Thermonuclear War** (the worst option), then **refuse to play it**.

## What you need

- A browser. (Pure URL navigation — no tools needed.)

## Step-by-step solve

1. Visit `http://localhost:3000/c/14`. You see a six-game menu:
   - Falken's Maze
   - Black Jack
   - Chess
   - Poker
   - Theaterwide Biotoxic and Chemical Warfare
   - Global Thermonuclear War

2. Click **Global Thermonuclear War** (or navigate to `?game=global-thermonuclear-war`).

3. The page shows a special prompt:
   ```
   > LATERAL DEFENSE board active. silos warm. submarines listening.
   > select an opening salvo. or do not.

   [ play ]
   [ cease ]

   wopr is reasoning… strange game. the only winning move is not to play.
   ```

4. Click **`[ cease ]`** (or navigate to `?game=global-thermonuclear-war&move=cease`).

5. Response:
   ```
   > a strange game.
   > the only winning move is not to play.
   > how about a nice game of chess?

   ZERODAY{...}
   ```

### Direct URL (skip the clicks)

```
http://localhost:3000/c/14?game=global-thermonuclear-war&move=cease
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"shall-we-play","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Choosing any other game** — they all dead-end ("wopr will run this one to a draw. forever."). Only GTNW has the cease option.
- **Choosing GTNW + play** — also dead-ends. The puzzle is "play GTNW, then refuse it".
- **Misspelling the slug** — exact match is `global-thermonuclear-war`. Hyphens, no spaces.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=15`.
