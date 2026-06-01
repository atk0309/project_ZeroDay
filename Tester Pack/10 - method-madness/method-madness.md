# 10 — Method in the madness

- **Slug:** `method-madness`
- **Category:** Net · **Points:** 30
- **Surface:** `wopr.example.com` (subdomain dispatch — see note below)
- **GIBSON key part:** —

## Premise

The puzzle is keyed off the HTTP verb, not the path. Landing page (GET) hints "this terminal listens, but only to the right verb" and points at OPTIONS as the discovery channel.

## ⚠ Important — hub vs subdomain

The hub route `GET /c/10` is GET-only and never reaches the full method dispatcher. **You must hit the subdomain** (`wopr.example.com`) to send PATCH requests.

Local options:
- **Easiest**: edit `/etc/hosts` to map `wopr.example.com` to `127.0.0.1` (see `00 - Setup/Setup.md` Step 9), then hit `http://wopr.example.com:3000/`.
- **Or**: use curl's `--resolve` flag to map without touching `/etc/hosts`:
  ```bash
  curl --resolve wopr.example.com:3000:127.0.0.1 -i ...
  ```

## What you need

- `curl` with `-X` to set arbitrary methods. Browsers can't easily send PATCH from the address bar.

## Step-by-step solve

1. Read the landing first (GET):
   ```bash
   curl --resolve wopr.example.com:3000:127.0.0.1 \
     -b "PLAYER_COOKIE=<your-cookie>" \
     http://wopr.example.com:3000/
   ```
   Body says "the right verb is the one you reach for when you intend to **change** something — not create, not erase. amend."
2. Discover allowed verbs with OPTIONS:
   ```bash
   curl --resolve wopr.example.com:3000:127.0.0.1 -i -X OPTIONS \
     -b "PLAYER_COOKIE=<your-cookie>" \
     http://wopr.example.com:3000/
   ```
   Response:
   ```
   HTTP/1.1 204 No Content
   Allow: GET, HEAD, OPTIONS, PATCH
   ```
3. PATCH means "amend" — that's the verb. Send it:
   ```bash
   curl --resolve wopr.example.com:3000:127.0.0.1 -i -X PATCH \
     -b "PLAYER_COOKIE=<your-cookie>" \
     http://wopr.example.com:3000/
   ```
4. Response:
   ```
   HTTP/1.1 200 OK
   X-Wopr-Patch: ZERODAY{...}

   accepted. patch applied.

   ZERODAY{...}
   ```
5. Flag is in both the body and the `X-Wopr-Patch` response header.

Other methods (POST, PUT, DELETE) return `405 Method Not Allowed` with the same Allow header.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"method-madness","flag":"ZERODAY{...}"}'
```

(Submit always goes to the *hub* origin, regardless of which subdomain hosted the puzzle.)

## Common failure modes

- **Trying PATCH against `/c/10`** — the hub's route is GET-only. You'll get a 404 or a route mismatch.
- **Subdomain unreachable** — confirm `/etc/hosts` or `--resolve` is set up correctly. `curl -v` shows the resolved IP.
- **Browser POST/PUT extensions** — most extensions don't send PATCH cleanly. `curl` is the reliable path.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=11`.
