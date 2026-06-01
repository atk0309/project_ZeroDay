# 00 — Setup

Boot a clean local dev instance, become admin, configure the game, and sign up as a player. Total time: ~5 minutes the first run.

---

## Prereqs

- Node `>=24` (CI runs Node 24; older Node may work but isn't tested).
- `npm` 10+.
- SQLite is bundled by `better-sqlite3` — no system lib install needed.

```bash
node --version       # v24.x
npm --version        # 10.x
```

---

## Step 1 — Clone and install

```bash
git clone https://github.com/atk0309/project_zeroday
cd project_zeroday
git fetch origin dev
git checkout dev
npm ci
```

## Step 2 — Configure `.env`

Copy the tester template:

```bash
cp "Tester Pack/00 - Setup/env.example.test" .env
```

Open `.env` and replace the two `change-me`/`tester-pack-...` values with random strings:

```bash
# Linux/macOS one-liner — generates two new secrets and prints them
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "FLAG_SECRET=$(openssl rand -hex 32)"
```

> **Don't** rotate `FLAG_SECRET` mid-run — every flag you've seen becomes invalid. For testing it's fine to wipe the DB and start over.

## Step 3 — Migrate and boot

```bash
npm run migrate     # creates ./data/zeroday.db, applies schema, seeds 19 challenges
npm run dev         # tsx watch on :3000
```

You should see:
```
[time] INFO: Server listening at http://0.0.0.0:3000
[time] INFO: db: resolved sqlite path { dbPath: '.../data/zeroday.db', source: 'DB_PATH' }
```

Leave this terminal open. Open a second terminal for everything else.

---

## Step 4 — Bootstrap the admin (5-click easter egg)

This is intentional friction. There's **no** signup form for admins — the password is set via a deliberately quirky empty-fields-clicked-five-times routine.

1. Visit `http://localhost:3000/admin/login`.
2. Leave **both** Email and Password fields completely blank.
3. Click `[ login ]`. Page shows `> missing credentials`.
4. Click `[ login ]` four more times. **Same fields, same blank values.** If you type anything in either field, the counter resets.
5. On the 5th empty click the screen morphs to `> unrecognized incantation accepted. > set new admin password.`
6. Enter a password (8+ chars), confirm, submit.
7. You're now logged in as `admin@example.com` (the default email — editable later in `/admin/account`).
8. You land on `/admin/setup`.

If you reset the DB later, this whole dance repeats. Once a password is set, the easter egg is dead until you wipe `app_settings`.

> **Stuck on no-JS browsers?** `http://localhost:3000/admin/login?fallback=password` renders password mode server-side once the password is set.

---

## Step 5 — Set the game timing

In `/admin/setup`, find the **Game timing** card.

For immediate `live` phase, set:
- `launch_at` = current UTC time minus 1 minute
- `end_at` = current UTC time plus 24 hours

Click save. The settings cache is 30 s TTL, so phase changes can take that long to propagate. Refresh the page after a few seconds.

You can confirm phase is live by hitting `http://localhost:3000/` while logged out — you should see the lobby/hub redirect to recruit, not the "system offline" page.

While on `/admin/setup`, also confirm the **GIBSON key parts** card reads `3 of 3 wired (#7, #13, #17)`. If it doesn't, something is wrong — `lib/gibson.ts:GIBSON_KEY_PARTS` should have three real 16-hex values.

---

## Step 6 — Skip mail (use dev_link fallback)

For tester runs, leave the mail subsystem **unconfigured**. Magic links and invite claim links surface inline as a `dev_link` URL on the next page — no real email needed.

If you want to test the mail flow itself (Resend or SMTP) configure it in `/admin/account?section=mail` and run `[ send test ]` to flip `mail_configured=true`. Otherwise skip this step entirely.

---

## Step 7 — Sign up as a player

1. Open a **second** browser (or private window) so the admin session and player session don't collide.
2. Visit `http://localhost:3000/recruit`.
3. Pick an alias (3–20 chars, must be unique) and an email (any string with `@`).
4. Click `[ continue ]`. The pill-choice page appears.
5. Click the **red pill**.
6. Page renders with `devLink: http://localhost:3000/auth?token=<48-hex>`. Click that link.
7. You're logged in. Cookie `PLAYER_COOKIE` is set. You land on `/`.

Your `current_ordinal` is now `1`. The hub shows the 19-cell grid; only cell #1 is clickable.

---

## Step 8 — Capture your `PLAYER_COOKIE` for curl

Most challenges are easy in the browser. A few (e.g. #5 headers, #10 method-madness) need `curl` because you have to set a header or HTTP method. Grab your cookie:

1. With the player tab open at `http://localhost:3000/`, open DevTools.
2. Application tab → Cookies → `http://localhost:3000` → row `PLAYER_COOKIE`.
3. Copy the **value** (a long random string).

Use it in curl as:
```bash
curl -b "PLAYER_COOKIE=<paste-value-here>" http://localhost:3000/c/5
```

Save the value somewhere — you'll reuse it across challenges.

---

## Step 9 — (Optional) Test subdomain routing locally

Most testers can ignore this and just use `/c/<ordinal>` URLs. If you want to test the subdomain dispatcher (which is what challenge #10 actually requires for non-GET methods), edit `/etc/hosts`:

```
127.0.0.1   example.com
127.0.0.1   hack.example.com
127.0.0.1   oracle.example.com
127.0.0.1   zero.example.com
127.0.0.1   wopr.example.com
127.0.0.1   gibson.example.com
127.0.0.1   mitnick.example.com
```

Then visit e.g. `http://wopr.example.com:3000/`. (You'll need the port unless you also have a reverse proxy.)

The fallback is fine: every challenge MD shows the hub-routed URL first.

---

## Reset checklist

To rerun cleanly:

```bash
# stop `npm run dev` first
rm -f data/zeroday.db
npm run migrate
npm run dev
```

Then redo Steps 4–7. Your `flag_salt` is regenerated; flags are different.

If you only want to clear *one* player's progress without nuking the whole DB, the admin console can do it: open the player drawer at `/admin` and use the row's actions, or hit `/admin/api/player/:id/skip` to advance them past their current stage (logs an `admin_skip` event).

---

## Common boot problems

- **`vitest: not found`** — you're trying to run tests without `npm ci`. Install deps first.
- **`Server listening...` but `/` returns 502** — server is fine but you're hitting it through a stale proxy. Hit it directly on `:3000`.
- **`/admin/login` shows "set new admin password" immediately** — the DB is empty. Skip the 5-click and just set the password.
- **Player keeps redirecting to `/recruit`** — the `PLAYER_COOKIE` isn't being sent. Check it's set on the same origin you're hitting (don't mix `localhost:3000` with `127.0.0.1:3000` — cookies don't cross hostnames).
- **All challenges return 403 `not your current stage`** — you're trying to submit out of order. Hit `/c/<your-current-ordinal>` (see `GET /api/me`) and submit that flag first.
