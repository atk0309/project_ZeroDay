# Hosting on Railway

Two-environment setup: `main` → production, `dev` → staging. Predictable
~$5/mo flat bill on the Hobby plan, no platform-specific files in the repo.
Production will eventually move to a Hetzner VPS; nothing here locks us in.

## What's wired in the repo

- `npm start` runs `tsx app/src/db/migrate.ts && tsx app/src/server.ts`. Migrate is idempotent (every `CREATE` uses `IF NOT EXISTS`), so it's safe on every boot.
- `tsx` is a runtime dependency, so Nixpacks needs no explicit application
  build step — install deps, `npm start`, done. `npm ci` does compile the
  native Argon2 and SQLite modules during installation.
- `app/src/db/index.ts` reads `DB_PATH` (default `./data/zeroday.db`). Railway's volume mounts at `/data` and we point `DB_PATH=/data/zeroday.db` so SQLite survives redeploys.
- `app/src/server.ts` already binds `0.0.0.0` and reads `PORT` — both required by Railway.

## 1. Production environment

1. **Create the account.** [railway.com](https://railway.com) → "Login with GitHub" → Hobby plan ($5/mo, includes $5 of usage credit; this app fits inside that).
2. **New Project → Deploy from GitHub repo** → pick `atk0309/project_zeroday`. The default environment Railway creates is fine — rename it to `production` for clarity. Set the deploy branch to `main`.
3. **Add a volume.** Service → Volumes → New Volume. Mount path: `/data`. Size: 1GB.
4. **Set environment variables** (Service → Variables):
   - `DB_PATH` = `/data/zeroday.db`
   - `SESSION_SECRET` = long random string (`openssl rand -hex 32` or any password generator)
   - `FLAG_SECRET` = different long random string (this is what makes per-player flags unforgeable)
   - `PUBLIC_ORIGIN` = `https://hack.example.com` (the canonical hub host — used in magic-link emails)
   - `NODE_ENV` = `production`
   - **Don't** set `PORT` or `HOST`. Railway injects `PORT`; the server defaults `HOST` to `0.0.0.0`.
   - **Don't** set `RESET_ADMIN` / `RESET_ADMIN_SAFETY` here unless you're actually resetting the admin password — see "Emergency admin reset" below.
5. **Verify the first deploy.** Should kick off automatically when env vars save. Deploy logs should show `migrated 19 challenges into registry` then `zeroday listening on 0.0.0.0:<PORT>`.
6. **Get a URL.** Service → Settings → Networking → Generate Domain. Gives you `something.up.railway.app`. Hit it from your phone to confirm it's alive (you'll land on the admin bootstrap or the public face).

## 2. Custom domain on production (Cloudflare)

Path-based routes (`/c/:ordinal`) work immediately on the railway.app URL. The host-based challenge subdomains (`gibson.example.com`, `oracle.example.com`, etc., hardcoded in `app/src/challenges/registry.ts`) need your own domain.

1. **Railway side.** Service → Settings → Networking → Custom Domain. Add **two** entries:
   - `hack.example.com` (or whatever your hub host is)
   - `*.example.com` (so Railway accepts arbitrary challenge subdomain host headers — without this, requests to `gibson.example.com` etc. 404 at the Railway router before reaching the app)
2. **Cloudflare side.** In your zone, add two CNAMEs both pointing to the Railway target Railway showed you (something like `xxxx.up.railway.app`):
   - `hack` → `xxxx.up.railway.app` — proxied (orange cloud)
   - `*` → `xxxx.up.railway.app` — proxied
3. **Update `PUBLIC_ORIGIN`** in Railway to `https://hack.example.com` so magic-link emails use the real hostname.

Cloudflare proxy mode (orange cloud) means Cloudflare terminates TLS at the edge — no Railway-issued certs needed. Cloudflare's free Universal SSL covers the apex + one wildcard level (`example.com` and `*.example.com`), which is exactly what we need.

## 3. Staging environment

Once production is healthy, fork a second environment so iteration on `dev` doesn't risk the live URL.

| | `production` | `staging` |
|---|---|---|
| Branch | `main` | `dev` |
| URL | `hack.example.com` | the auto `*.up.railway.app` |
| Volume | prod volume | **separate** volume |
| `FLAG_SECRET` / `SESSION_SECRET` | real | **different** values |
| `PUBLIC_ORIGIN` | `https://hack.example.com` | the railway.app URL |

**Why every field must be separate:** sharing the volume means a bad migration on staging corrupts prod. Sharing `FLAG_SECRET` or `SESSION_SECRET` means a session cookie or a flag generated on staging is valid on prod — a real leak vector.

**Don't put staging on a sibling subdomain of production** (e.g. `staging.example.com` while prod is `hack.example.com`). Browsers treat anything under the same registrable domain (`example.com`) as same-site, so `SameSite=Strict`/`Lax` cookies still ride along on cross-origin requests between siblings. Active content on staging — or a staging XSS — could then drive authenticated POSTs against production. The app does have an Origin/Referer CSRF check on admin routes (see invariant #15 in `CLAUDE.md`), so this isn't an automatic takeover; but the standard guidance is still to keep staging on the Railway-provided `*.up.railway.app` host or a different registrable domain.

**Dashboard steps:**

1. Project page → "+ New Environment" → name `staging` → "Fork from production" (copies vars over as a starting point).
2. Service → Settings → Source → change deploy branch to `dev`.
3. Service → Volumes → New Volume, mount `/data`, 1GB. The forked env does *not* inherit the prod volume — confirm only one mount exists and it's the new one.
4. Service → Variables → regenerate `FLAG_SECRET` and `SESSION_SECRET` (different long random strings from prod). Change `PUBLIC_ORIGIN` to the staging railway.app URL.
5. Service → Settings → Networking → Generate Domain to get the staging URL. (Skip custom domain — see next section for why.)

## 4. What works on staging vs. prod

Staging on the railway.app URL has full puzzle-logic coverage but limited UX coverage:

| | Path routes (`/c/:ordinal`) | Host-routed subdomains |
|---|---|---|
| Production (`hack.example.com`) | ✅ | ✅ (via Cloudflare wildcard) |
| Staging (`*.up.railway.app`) | ✅ | ❌ (host header doesn't match registry) |

The challenge registry hardcodes prod hostnames, and `app/src/server.ts:78` does an exact host match — so on staging the host is `something.up.railway.app` and the subdomain dispatcher silently falls through. Test puzzle logic, the admin console, magic-link auth, ordinal progression etc. via `/c/:ordinal` paths and the hub UI; smoke-test the subdomain UX on prod after merge.

If full subdomain testing on staging becomes important, the options (in cost order) are:

1. **Buy a flat staging domain** (~$10/yr e.g. `zeroday-test.com`). Cloudflare's free Universal SSL covers `*.zeroday-test.com`. Needs a small code change to make the base domain env-driven (`BASE_DOMAIN` env var; registry stores subdomain prefixes; runtime concatenates) — that change is not in the repo today.
2. **Cloudflare Advanced Certificate Manager** ($10/mo) — gets a `*.staging.example.com` cert and the same code change as above. More expensive but no second domain to manage.

Sticking with path-based testing on staging until that's actually a problem.

## 4a. Troubleshooting — "every deploy wipes my data"

If you set up admin credentials, mail, launch timestamps, or recruit content
and they vanish after the next push, the SQLite file is on the container
filesystem instead of the volume. Containers are recreated on every deploy —
anything not on the mounted volume is gone.

Checklist:

1. **Volume attached?** Service → Volumes. There should be exactly one volume
   with mount path `/data` (or whatever you chose). If the list is empty, add
   it (step 3 above).
2. **`DB_PATH` set on the right environment?** Variables tab on the *staging*
   service must have `DB_PATH=/data/zeroday.db`. Production variables don't
   apply to staging — every environment is its own variable scope.
3. **Confirm with the deploy log.** On boot the app logs
   `db: resolved sqlite path` with the path it's actually using. If it says
   `./data/zeroday.db` (relative) and Railway env is set, the volume isn't
   wired and the path is ephemeral. The app also emits a `WARNING:` line on
   `console.warn` in this case — searchable in Railway's log viewer.
4. **Auto-detect fallback.** Even without `DB_PATH`, the code now reads
   `RAILWAY_VOLUME_MOUNT_PATH` (Railway injects this automatically for any
   service with a volume) and writes to `<mount>/zeroday.db`. So as long as
   the volume exists, data should survive — but `DB_PATH` is still the
   recommended explicit form.

After any of those changes, redeploy once, configure the admin console, push
a trivial commit (e.g. a README typo) to trigger another deploy, and confirm
the admin password and timing settings still work after the redeploy. That
round-trip is the only real proof the volume is wired.

## 4b. Emergency admin reset

If the admin password is lost and you don't want to (or can't) shell into the
volume to edit SQLite directly, you can re-arm the 5-click easter egg from
Railway's Variables tab.

1. Service → Variables → add **both**:
   - `RESET_ADMIN=true`
   - `RESET_ADMIN_SAFETY=<positive integer strictly higher than the last one used>` — start at `1` if you've never reset before. Inspect `app_settings.admin_reset_nonce` in the DB if you're not sure what the previous value was.
2. Trigger a redeploy. The boot logs will print
   `admin: password cleared via RESET_ADMIN — easter egg armed for next /admin/login visitor`.
3. **Immediately** open `https://<your-hub-host>/admin/login` and run the
   5-click bootstrap (see `docs/operator.md` → "Step 1"). Whoever lands on the
   page first wins admin — plan to be there when the deploy goes green.
4. Once you've set the new password, **unset both vars** (or set
   `RESET_ADMIN=false`). Leaving them set won't re-reset on subsequent
   redeploys — the nonce is consume-once — but it removes a footgun for
   future-you (who would otherwise have to bump the counter to reset again).

Consume-once semantics: `RESET_ADMIN_SAFETY` is persisted in
`app_settings.admin_reset_nonce` after a successful reset. The next boot only
reruns the reset if `RESET_ADMIN=true` **and** the env nonce is strictly
greater than the stored value. So a stale `RESET_ADMIN=true` with the same
nonce does nothing.

**Security note.** Anyone with Railway project access (collaborators, the
GitHub integration's deploy hooks, anyone who's stolen a Railway session)
can trigger this. That's the same trust boundary as "anyone with shell on
the volume", which is the threat model we already accept for the SQLite DB
itself. But it does mean the admin claim is only as secure as your Railway
account — turn on 2FA.

## 5. Iterate workflow

- I push to `dev` → staging redeploys in ~60s → you test on the staging URL.
- When `dev` looks good, you merge `dev → main` via a GitHub PR. **Use "Create a merge commit" or "Rebase and merge" — not "Squash and merge"** — so the `dev` branch stays in sync with `main` after the merge (squash creates a new commit hash and `dev` would diverge in history even though contents match).
- After each merge to `main`, fast-forward `dev`: `git checkout dev && git merge --ff-only origin/main && git push`. (I'll do this when working from this session.)
- Risky/experimental work happens on short-lived feature branches off `dev`, PR'd into `dev`, never directly into `main`.

If a deploy goes wrong, dashboard has full deploy logs; runtime logs stream live in the same view.

## 6. Migrating off Railway later

Nothing in the code is Railway-specific. To move to Hetzner: run `npm ci && npm start` on the VPS with the same env vars set, point `DB_PATH` at a real disk path, `scp` the `.db` file across during cutover. Caddy or nginx fronts it for TLS — Cloudflare DNS-01 handles the wildcard cert.
