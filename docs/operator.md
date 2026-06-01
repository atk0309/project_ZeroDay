# Operator Runbook

Everything you need to run the zeroday ARG. Audience: the human operating the game (you). Pair this with [`README.md`](../README.md) for project context.

## Deployment

### One-time: DNS

Set up `*.example.com` A-record pointing at your VPS IP. Caddy will request a wildcard cert via Cloudflare DNS-01 — you'll need a Cloudflare API token scoped to `Zone.DNS:Edit` for the `example.com` zone.

### One-time: VPS

```bash
# Install Docker + Compose
curl -fsSL https://get.docker.com | sh

# Open the firewall — only 22 (your ssh, change if you've moved it),
# 80, 443, and 31337 (port-scan challenge banner).
ufw allow 22/tcp 80/tcp 443/tcp 31337/tcp
```

### Boot

```bash
git clone https://github.com/atk0309/project_zeroday
cd project_zeroday/ops

# Required env (NOT game state — these are infra secrets):
cat > .env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
FLAG_SECRET=$(openssl rand -hex 32)
PUBLIC_ORIGIN=https://hack.example.com
CLOUDFLARE_API_TOKEN=cf_xxx_your_token_here
EOF

# Optional: pre-seed mail credentials so you can skip the wizard on a fresh
# deploy. See `.env.example` for the MAIL_* vars and Step 2 below for the
# admin-owns-after-first-boot semantics.

# Optional: Microsoft Clarity for session-replay/heatmaps. When set, the
# cookie-consent banner's "Accept" button loads
# https://www.clarity.ms/tag/<id>. Leave unset to disable Clarity entirely.
# The consent banner appears on every public page either way (it also
# discloses Cloudflare Web Analytics, which is edge-injected and runs
# regardless of the visitor's choice). See /privacy for the user-facing
# copy.
#   CLARITY_PROJECT_ID=your-clarity-project-id

docker compose up -d
docker compose logs -f app
```

You should see Fastify listening on :3000. Visit `https://hack.example.com/` — it'll render the "system offline" page until you initialize.

> ⚠️ **Rotate `FLAG_SECRET` only between cohorts.** Changing it mid-event invalidates every existing player's flags. Same for `SESSION_SECRET` (forces everyone to log in again).

## First-run initialization

This is the fun part — the bootstrap flow is intentionally a little theatrical.

### Step 1: Set the admin password (the 5-click easter egg)

1. Visit `https://hack.example.com/admin/login`. You'll see a normal-looking email/password form with two buttons: `[ login ]` and `[ magic link ]`.
2. **Leave both fields completely empty** and click `[ login ]`. The screen complains: `> missing credentials`.
3. Click `[ login ]` again. Same complaint.
4. And again. And again.
5. On the **5th click** — same empty fields — the screen morphs to:
   ```
   > unrecognized incantation accepted.
   > set new admin password.
   ```
6. Enter a password (8+ characters), confirm, submit. You're now logged in as the admin (default email: `admin@example.com` — editable later) and dropped at `/admin/setup`.

> **Why this way?** Because there's no "first user wizard" route — there's only the login screen. No sign-up endpoint exists for admins. The 5-click + empty-fields requirement is a deliberate friction so it can't be triggered by accident or by someone fiddling with autofill. It's only available while `admin_password_hash IS NULL`; the moment it's set, the easter egg is dead and only password / magic-link auth works.
>
> **If you typed anything in either field**, the click counter resets. Five *deliberate* empty submits are required.

### Step 2: Configure the mail subsystem

Mail lives under `/admin/account?section=mail` — it's a system setting (operator-owned), not part of the launch wizard. From the dashboard, open the user menu in the top-right and pick **account**, then click the **mail subsystem** tab in the sidebar. Fill in:

- **Provider**: `resend` (HTTP API, simpler) or `smtp` (any SMTP server: Mailgun, SES, your own postfix).
- **From address**: defaults to `recruit@example.com` (must be a domain you've verified with the provider).
- **Admin email**: where magic links and test mails go. Defaults to `admin@example.com`.
- For **Resend**: paste the API key. This is your Resend account token (prefix `re_`); `lib/mail.ts` passes it to the Resend SDK so every outbound message authenticates against your account. Without it, no mail can be sent.
- For **SMTP**: host, port (587 for STARTTLS, 465 for implicit TLS), secure checkbox, user, pass.

Click `[ save mail config ]`, then `[ send test message ]`. If the test arrives in your inbox, the system flips `mail_configured = true` and the magic-link button on `/admin/login` becomes available. Until then, password is the only way in.

> **Skipping the form on a fresh deploy.** If you set the mail env vars (see `.env.example`) before first boot, those values are seeded into `app_settings.mail_*` automatically. `MAIL_PROVIDER` is inferred when omitted — set just `MAIL_RESEND_API_KEY` and the provider defaults to `resend`; set just `MAIL_SMTP_HOST` and it defaults to `smtp`. The admin console still owns the row after that — env edits are *not* re-applied on subsequent boots. Seeding does **not** flip `mail_configured=true`; you still have to click `[ send test message ]` once to verify a real round-trip before magic-link login becomes available. To re-seed (e.g. after rotating creds), wipe the rows: `DELETE FROM app_settings WHERE key LIKE 'mail_%';` and restart.

### Step 3: Set the D-Day timestamps

In the **Game timing** card:

- **launch_at**: when the GIBSON opens. Players in pre-launch see the lobby + countdown; at this moment the countdown flips and challenges become available.
- **end_at**: when the leaderboard freezes and the GIBSON locks forever.
- **Timezone**: a label only (the timestamps are stored in ISO/UTC). Pick something sensible for the operator UI.

Save. The phase machine takes effect immediately:
- if `now < launch_at` → players see the lobby + countdown to launch
- if `launch_at ≤ now < end_at` → players see the hub + countdown to end
- if `now ≥ end_at` → leaderboard frozen, GIBSON returns lights-out page

The cache is 30s; expect timing changes to take effect within a minute.

### Step 4 (optional): Recruit content

In the **Recruit content** card you can preview/edit:

- **Recruit email body**: what gets emailed when a kid hits "take the red pill"
- **Lobby flavor**: one line per row, displayed as the rolling fake `tail -f /var/log/wopr.log` ticker on the pre-launch lobby. Use `[count]` as a placeholder for the random "T-MINUS XX:XX" insertion.

Defaults are baked in if you skip this.

## Day-of-event tasks

### Recruiting players

The recruit landing is at `/recruit` (any host). It's a 2-step flow: alias + email + `[ jack in ]` on the first screen, then a separate red-pill / blue-pill choice on the second. Red pill = magic link emailed; blue pill = a "goodbye" screen whose copy escalates over repeat visits (`localStorage`-tracked, decorative). Players can sign up any time before D-Day; pre-launch they land in the lobby after consuming the magic link.

If you want a token-gated invite (so random visitors hit a parked page), put `?token=<opaque>` in the recruit URLs you email out and validate it client-side. The current build doesn't enforce token-gating server-side — that's a 10-minute extension when you need it.

### Invitations (PR2)

Operator-issued invitations live alongside open `/recruit` signup. Each operator has `invitations_per_operator` slots (default `2`) — `pending` and `accepted` invitations both occupy a slot, revoke + expiry free one. Tokens decay after `invite_token_ttl` (default `72h`, settable as `Nh|Nm|Nd`).

- **From the lobby (operator)**: filled forms in `lobby.ejs` POST to `/lobby/invite` (issue), `/lobby/invite/:id/revoke` (owner-only revoke), `/lobby/invite-request` (ask the admin for a 3rd slot · 1 pending request per requester). On success the operator gets a `?msg=invited|revoked|requested` flash; if mail isn't configured the lobby surfaces the dev claim link inline.
- **From the admin console**: `/admin/players?tab=invitations` lists all rows with funnel KPIs and a `[ + invite operative ]` admin-override CTA (POSTs `/admin/api/invitations` with `source='admin_override'`, bypasses the operator's quota). `?tab=requests` queues pending invite-requests with inline approve/deny — approval auto-spawns an `admin_grant` invitation. Both routes audit-log under `invite_send`, `invite_revoke`, `request_approve`, `request_deny`.
- **The claim flow**: invitees hit `/claim/:token`, pick an alias (3-20 chars, must be unique), and land in the lobby with a session minted. Dead tokens render `claim-dead.ejs` with a reason (`unknown token`, `invitation expired`, `invitation revoked`, `invitation already claimed`).
- **Email templates**: `/admin/players?tab=emails` is the single workspace for every operator-editable copy block — six email families (recruit, invite, accept_confirm, request_received, request_approved, request_denied) plus the lobby flavor lines, all in one form. Each card carries a live client-side preview, a `[ preview ]` button that renders the saved template server-side via the same code path real sends use, and `[ send test ]` which dispatches the rendered output to the configured admin email. Defaults seed automatically only when the rows are literal-`null`. To force a re-seed of any family: `UPDATE app_settings SET value = NULL WHERE key IN ('<family>_email_subject','<family>_email_body');` and restart. The accept_confirm template fires on `/claim/:token` success; the request_received template fires when an operator submits an invite-request; the request_approved and request_denied templates fire from the admin's approve/deny endpoints.
- **Closing `/recruit` is deferred**: open signup still works. Routing all new operators through invitations is a deliberate later PR.

### Live monitoring

`/admin` has two layouts — a **chip strip at the top** flips between them and the choice persists in the `admin_variation` cookie:

- **A · dense ops** (default): KPI strip with sparklines (active <1h, submits/hr) → players grid + side rail (live feed, stuck queue, global ops) → audit log.
- **B · narrative**: phase-strip hero with d/h/m/s countdown → top-of-pack cards + needs-attention cards → 19-cell cohort funnel → live feed → audit log.

Both share the same data; pick whichever reads better for you.

What the surfaces show:

- **Players grid (dense)**: alias, current stage with 19-cell progress bar, solves, hints, skips, last advance. Click any row to open the player detail drawer; row actions: `[ open ]`, `[ hint ▾ ]` dropdown (L1 -2 pts / L2 -5 pts / L3 -10 pts), `[ skip ]`.
- **Search + stuck-only filter** above the grid. `?q=alias_or_email` and `?stuck=1` are also valid URLs (the form just sets them).
- **Player detail drawer** — slides in from the right when you click a row. Shows the 19-cell progression map, identity & state KV (stage, solves, attempts, hints used, skips, time-on-stage, last advance, flag-salt prefix), the 10 most recent attempts (right/wrong + submitted text), and footer actions (resend magic link — pending wiring; send hint dropdown; skip stage). All footer actions hit `/admin/api/player/:id/*` JSON endpoints; if JS is off, every action also has a form-POST fallback in the row.
- **Stuck (>20h on current stage)** card (dense) / **Needs attention** cards (narrative): players past 20h on a stage. Each card has the same hint dropdown + skip controls as the row.
- **Cohort funnel** (narrative only): 19-cell histogram, count of operators currently on each trial.
- **Live feed**: tail of recent events. Auto-refreshes every 5 s — new rows prepend with a phosphor flash. Polls `GET /admin/api/events?since=:lastId`.
- **Audit log**: every admin action (`login`, `login_fail`, `set_password`, `config_change`, `skip`, `send_hint`, `send_test_mail`, `magic_link_sent`, `session_revoke`, `invite_send`, `invite_revoke`, `request_approve`, `request_deny`) with email, timestamp, IP.

### Admin account (password + sessions + mail)

`/admin/account` is **separate from the launch wizard** — it's where the operator manages their own credentials and the mail subsystem. Two tabs in the sidebar:

- **Password** (`?section=password`, default):
  - **Rotate the passphrase**: requires the current password. On success, every other admin session is killed (`destroyOtherSessions`) — anyone else logged in as admin is signed out on next request. The current session keeps going.
  - **Active sessions table**: one row per live admin session, with parsed device/browser, IP, and last-seen relative time. The current session is marked `· this session` and can't self-revoke from this row (use `[ logout ]` instead). Other sessions show `[ revoke ]` — clicking calls `POST /admin/account/sessions/:id/revoke` and immediately ends that session.
- **Mail subsystem** (`?section=mail`): provider + creds + verification round-trip. See **Step 2: Configure the mail subsystem** for the full walkthrough. Routes: `POST /admin/account/mail` (save config) and `POST /admin/account/mail/test` (verify).

### Sending hints

Each challenge has 3 pre-authored hints (defined in the handler module): L1 nudge, L2 strong, L3 near-spoiler. The hint queue surfaces stuck players; click L1/L2/L3 to email that level to the player. The send is logged in `hints_sent` and shows on the leaderboard as a count next to that player's row.

> The 09:00 cron *queues* candidates into the events table but does **not** auto-send. You always click. This keeps you in the loop and prevents the system from spamming a kid who's about to solve.

### Skipping a stuck player

If someone is genuinely stuck (e.g. hint-3 sent, 24h+ no progress, you've concluded the puzzle is too hard for them):

1. Find their row in the players grid.
2. Click `[Skip →]`.
3. Confirm the dialog.

Effect:
- `current_ordinal` increments by 1
- `admin_skips` increments by 1 (visible as `⚠` next to their name on the leaderboard)
- A synthetic `solves` row is inserted with `flag_source='admin_skip'` and 0 points
- An `admin_skip` event fires; the audit log records who did it and when
- They get no email — the next time they refresh the hub, the next stage is open

Skips are forever; there's no "unskip". If you skipped by mistake, manually delete the synthetic solve and decrement `current_ordinal` in SQLite.

### Freezing the game

Happens automatically when `now >= end_at`. The cron stops dispatching hints, `/api/submit` returns 423, the GIBSON challenge returns the lights-out page, and `/board` shows a frozen banner. Leaderboard is read-only; previous solves remain visible.

To extend the deadline mid-event, just edit `end_at` in `/admin/setup` — the change takes effect within 30s of the cache TTL expiring.

## Mail provider details

### Resend

- Sign up at resend.com, verify your sending domain (DNS records: SPF + DKIM).
- Create an API key with `mail.send` scope, paste into the admin console.
- Recommended for low-volume (≤100 sends/day).

### SMTP

- Any provider: Mailgun, SES, Postmark, your own server, etc.
- For Gmail/Workspace: enable 2FA, create an App Password, use `smtp.gmail.com:587` with `secure=false` (STARTTLS). Note Gmail rate-limits aggressively (~500/day from a personal account).
- For SES: use the SMTP credentials from the IAM SMTP user, `email-smtp.<region>.amazonaws.com:587`.
- Test the config via `[ send test message ]` before relying on it.

### Switching providers mid-event

You can switch providers any time — the change takes effect immediately. `mail_configured` resets to `false` until you successfully run a test send on the new provider.

## Backup + recovery

### Daily SQLite snapshot

In the host's crontab:

```cron
0 2 * * * cd /opt/zeroday && sqlite3 data/zeroday.db ".backup '/opt/zeroday-backups/zeroday-$(date +\%Y\%m\%d).db'"
```

Keep ~7 days locally and rotate to off-host storage.

### Recovery scenarios

- **VPS lost**: spin up a fresh VPS, restore the latest `.db` to `/opt/zeroday/data/zeroday.db`, `docker compose up -d`. Sessions persist (server-side rows survive). Players log back in via magic link.
- **Forgot admin password**: two paths, pick whichever you have access to.
  - *SQLite shell*: `DELETE FROM app_settings WHERE key = 'admin_password_hash';`. Now `adminState() === 'uninitialized'` and the 5-click easter egg works again. Set a new password. The `admin_email` row is unchanged.
  - *Host env vars (Railway / `ops/.env`)*: set **both** `RESET_ADMIN=true` and `RESET_ADMIN_SAFETY=<positive int strictly higher than the last one used; start with 1>`, then redeploy. On boot the app clears `admin_password_hash` and persists the nonce in `app_settings.admin_reset_nonce`. The 5-click easter egg arms on the next `/admin/login` visit. **Race warning:** between the redeploy completing and you clicking through the bootstrap, anyone who reaches `/admin/login` first will set the new password. Be on the page when the deploy goes green. Consume-once: leaving the vars set across future redeploys is a no-op — to reset again you must bump `RESET_ADMIN_SAFETY` AND keep `RESET_ADMIN=true`. After the reset, unset both vars so a stale `true` doesn't surprise you later. Audit row: `admin_reset_via_env` with `email='system'`.
- **Mail provider blew up**: temporarily switch to a different provider in `/admin/account?section=mail` (or edit `app_settings.mail_credentials` directly in SQLite as a last resort). Players who tried to log in during the outage can request another magic link.

## Common gotchas

- **CRT theme broken / no colors**: confirm `/static/terminal.css` returns 200 (Caddy → app, app's `@fastify/static` serves `web/static/`). If you've put it behind a CDN, set long cache headers — the file rarely changes.
- **Countdown stuck at `--d --h --m --s`**: the client JS reads `data-target` from `#countdown`. If `launch_at` / `end_at` aren't set, the partial doesn't render the digits. Phase will be `uninitialized`.
- **Magic link "expired or already used"**: tokens are 15-min single-use. If a kid clicks twice (e.g. preview-fetcher in their email client), the second click fails. They request a new one.
- **Player submits a flag and gets "not your current stage"**: they're trying to submit for a challenge ahead of where they are. Either they're guessing or they pasted a flag from a friend. Expected behavior.
- **Type-check fails after editing a route**: ES modules use `.js` extensions in import paths even from `.ts` source. `import { x } from './foo.ts'` won't compile — use `from './foo.js'`.

## Resetting between cohorts

```bash
# Stop the app
docker compose stop app

# Wipe player state but keep config
sqlite3 data/zeroday.db <<SQL
DELETE FROM users;
DELETE FROM user_progress;
DELETE FROM sessions;
DELETE FROM attempts;
DELETE FROM solves;
DELETE FROM hints_sent;
DELETE FROM events;
DELETE FROM magic_links;
SQL

# (Optional) rotate FLAG_SECRET to invalidate any leaked flags
# Edit ops/.env, change FLAG_SECRET to a new random hex, save.

# Set new launch_at / end_at via /admin/setup, then:
docker compose start app
```

The admin password, mail config, and recruit content are preserved.
