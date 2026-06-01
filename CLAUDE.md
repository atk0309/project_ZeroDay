# CLAUDE.md

You're picking up a Fastify+TypeScript+SQLite ARG. Players sign up, magic-link in, and clear 19 sequential challenges gated by per-player ordinal progress. A D-Day clock drives the whole experience (prelaunch lobby → live game → frozen lights-out). All runtime config lives in `app_settings` and is set via `/admin` — there is **no runtime `.env` for game state**.

This file is for you, the agent. Read it top-to-bottom on a fresh session — the order is deliberate. Pair with [`README.md`](README.md) (the human-facing pitch).

---

## Read this first — invariants you must not break

These describe non-obvious load-bearing facts. Re-derive any of these wrong and something silently breaks.

1. **`current_ordinal` advance is transactional.** `lib/progress.ts:recordCorrectSubmit` does `INSERT solves` + `UPDATE current_ordinal+1` + `INSERT events` in one `db.transaction(...)`. Splitting it lets concurrent submits double-advance.

2. **Submit validates the player's *current* ordinal before checking the flag.** `routes/submit.ts` returns 403 for any submit not at `current_ordinal` *before* verifying. This prevents leaking whether a guess at a future challenge was correct.

3. **Per-player salted flags are mandatory.** `lib/flags.ts:generateFlag(user, challengeId)` HMACs `user.flag_salt + FLAG_SECRET + challengeId`. Two users get two flags for the same challenge — sharing a flag does **not** share access. Touching this breaks the entire anti-cheat story.

4. **`app_settings` is a 30s read-through cache; writes invalidate it.** Source of truth for the key list is `lib/settings.ts:SettingKey` — keep that union authoritative, don't duplicate it here. Twelve of those keys are content templates seeded by `lib/content.ts:seedDefaults()` only when literal-`null` (empty string = operator deliberately cleared it, leave alone).

5. **Phase is computed, not stored.** `lib/phase.ts:phase()` reads `launch_at` / `end_at` and returns `uninitialized | prelaunch | live | frozen`. Never persist a phase. Always call `phase()`; don't compare timestamps inline.

6. **The 5-click admin bootstrap is server-gated.** `routes/admin/login.ts` only morphs to "set new admin password" when `admin_password_hash IS NULL`. Once set, the egg stays dead until a deliberate reset re-NULLs the hash (see below). Counter resets on any keystroke. The morph is *not* enough to authorize the actual bootstrap POST — the 5th clean empty click also issues a short-lived `admin_bootstrap_ready=1` cookie, and `mode=bootstrap` refuses ("bootstrap not armed") without it. Without that gate, an unauthenticated attacker on a fresh deployment could `POST mode=bootstrap` directly and seize the admin seat before the legitimate operator. Tests in `app/test/adminAuth.test.ts`.

   **Boot-time reset path (`lib/adminReset.ts:maybeResetAdmin`).** Setting `RESET_ADMIN=true` AND `RESET_ADMIN_SAFETY=<positive int strictly greater than stored>` on the host (Railway env / VPS `.env`) clears `admin_password_hash` on next boot, re-arming the easter egg. The nonce is consume-once: the value is persisted in `app_settings.admin_reset_nonce`, so leaving `RESET_ADMIN=true` set across redeploys is a no-op — the operator must bump the counter AND keep `RESET_ADMIN=true` for the next reset to fire. Audit row: `admin_reset_via_env`. This breaks the "egg is dead forever" property by design — anyone with infra-level env-var access can re-arm bootstrap, and there is a race window after redeploy where whoever hits `/admin/login` first claims admin. Plan to land on the page yourself before redeploying. Tests in `app/test/adminReset.test.ts`.

7. **The admin login form has three render modes — and a known footgun.** `adminState()` returns `uninitialized | password-set | mail-configured`. The streamlined `mail-configured` view ships a *single* hidden `<input name="mode">` whose value flips client-side; the route also normalizes array-typed `mode`/`email`/`password` defensively. The previous bug: two `name=mode` inputs collided into an array → `400 unknown mode`. The `?fallback=password` query renders password mode server-side so no-JS users (CSP, extensions, text browsers) can still get in. Don't regress either of these.

8. **Top-level `db.prepare(...)` runs at import time.** Several lib modules prepare statements at module-load — schema must exist before importing. Tests rely on `app/test/setup.ts` (a `setupFiles` entry) applying the schema before test files' static imports resolve.

9. **Mail config is owned by `app_settings` after first boot.** `lib/mail.ts:seedFromEnv()` writes env-var values into `app_settings.mail_*` *only when `mail_provider` is currently null*. Provider is inferred when omitted (`MAIL_RESEND_API_KEY` → resend, `MAIL_SMTP_HOST` → smtp). Seeding never flips `mail_configured=true`; only a successful `/admin/account/mail/test` round-trip does. Re-seed by wiping rows: `DELETE FROM app_settings WHERE key LIKE 'mail_%';`.

10. **SQLite path resolution is layered, with a loud warning on misconfig.** `db/index.ts` resolves: explicit `DB_PATH` → `RAILWAY_VOLUME_MOUNT_PATH/zeroday.db` → `./data/zeroday.db`. The third branch on Railway (`RAILWAY_ENVIRONMENT` set) emits a `console.warn` because that path is wiped on every redeploy.

11. **Invitation quota is enforced inside a transaction.** `lib/invitations.ts:createInvitation` runs `sweepExpired()` → existence checks → quota check inside `db.transaction(...)`. An operator may hold at most `invitations_per_operator` (default 2) in `{pending, accepted}`. `source='admin_override'` and `source='admin_grant'` pass `bypassQuota: true`. Always wrap stored `expires_at` in `datetime(...)` when comparing — `toISOString()` writes `2026-04-30T13:00:00.000Z` while `datetime('now')` returns `2026-04-30 13:00:00`, and `'T' > ' '` in ASCII makes naked string compare wrong.

12. **Cheat detection is shape-gated before the N-user scan.** `lib/cheatDetect.ts:detectFlagSupplier` fast-fails any submission that doesn't match `/^ZERODAY\{[A-F0-9]{24}\}$/`. Don't remove the shape filter — the HMAC iteration only runs on already-shape-matching wrongs. Honest misses never hit the scan path. The submit route calls this *after* `verifyFlag` returns false and *before* `recordWrongSubmit`.

13. **Strike system is two-strikes, transactional, and idempotent.** `lib/cheat.ts:recordCheatDetection` does five things in one transaction: log attempt, bump supplier `cheat_strikes`, insert `cheat_strikes` queue row, freeze the consumer, freeze the supplier iff strike ≥ 2. Supplier's next HTML request hits `/strike-notice` once per unack'd row; JSON `/api/*` routes pass through. `acknowledgeStrikes` is idempotent — a strike-2 supplier acking just lands on `/frozen`. Admin recovery is two separate routes (`unfreeze`, `clear-strikes`) so a strike-1 can be dropped without unfreezing a strike-2.

14. **Auth session cookies are `SameSite=Lax`, never `Strict`.** Both `PLAYER_COOKIE` (`routes/recruit.ts:setPlayerCookie`) and `SESSION_COOKIE` (`routes/admin/login.ts:setSessionCookie`) set `sameSite: 'lax'`. Magic-link auth is a cross-site top-level navigation: the click happens in the user's mailbox, and the server's `302 → /admin` (or `→ /`) executes inside the same cross-site nav chain. With `Strict` the browser stores the cookie but refuses to send it on the redirect, so the destination bounces straight back to the login page and the session only "wakes up" once the user manually navigates from the address bar. Lax keeps CSRF protection on POSTs while letting top-level GETs (which is what magic links are) carry the cookie. The short-lived `admin_login_clicks` cookie can stay `Strict` — it's only used during the same-site easter-egg interaction.

15. **All admin state-changing requests must pass an Origin/Referer check.** `middleware/adminAuthMiddleware.ts:rejectIfCrossOrigin` 403s any non-GET admin request whose `Origin` (or, fallback, `Referer`) host doesn't match the request's `Host` header. This is the only defense against same-site CSRF from a sibling subdomain (`staging.example.com → hack.example.com`): browser `SameSite=Strict`/`Lax` cookies still ride along on those requests because the registrable domain matches. Every admin preHandler — in `routes/admin/setup.ts` (via `requireAdmin`), `dashboard.ts`, `templates.ts`, `invitations.ts`, and `login.ts` — calls this helper before the cookie check. Tests/CLIs send neither header and pass through; modern browsers always set `Origin` on POST and so a cross-site forgery is rejected even when the cookie is attached. If you add a new admin POST plugin, register a preHandler that calls `rejectIfCrossOrigin` (use `'json'` mode for `/admin/api/*`, `'html'` otherwise). Tests in `app/test/csrfSameSite.test.ts`.

---

## Run it

```bash
npm ci                # install
npm run migrate       # create + seed SQLite (idempotent)
npm run dev           # tsx watch on :3000
npm test              # vitest run — see "test count" note below
npx tsc -p tsconfig.json --noEmit
```

`npm test` has a `pretest` hook that runs `scripts/check-base.mjs` and **fails if your branch is behind `origin/dev`**. Bypass for one-off cases: `CHECK_BASE_SKIP=1 npm test`. CI sets `CI=true` so the guard is skipped there.

For the current test count, just run `npm test` — vitest reports it. The number changes every PR; don't memorize it from this doc.

CI: `.github/workflows/ci.yml` runs type-check + vitest on `ubuntu-latest` Node 24.

---

## Branch flow — read before your first commit

Feature branches target **`dev`**, never `main`. Flow: `claude/<topic>` → PR into `dev` → after staging looks good, separate PR promotes `dev` → `main`.

**The first thing every session does on a `claude/*` branch is sync to `origin/dev`.** The harness sometimes hands over branches cut from `main`; those are silently behind dev by whatever has merged in between, and any baseline you measure (test count, file shape, route list) will disagree with CI.

```bash
git fetch origin dev
git rebase origin/dev   # resolve conflicts, re-run tests
```

The `pretest` hook enforces this. Rule of thumb: rebase first, edit second.

---

## Adding a new challenge

See [`docs/authoring-challenges.md`](docs/authoring-challenges.md) for the full how-to. Short version:

1. Slug already exists in `app/src/challenges/registry.ts` (all 19 are there).
2. Create `app/src/challenges/handlers/<slug>.ts` exporting `{ hints, page }` matching `ChallengeModule`.
3. Add to the `authored` map in `app/src/challenges/handlers/index.ts`. The stub handler stays as the fallback.
4. Use the `flag` parameter — it's already the per-player flag for that user.

---

## Common code paths

These are the paths worth knowing because they cross multiple files or have subtle ordering. Anything not listed here, just read the route file.

- **Player solves a challenge** → `POST /api/submit` → `verifyFlag` → `recordCorrectSubmit` (transactional advance).
- **Player submits another op's flag** → `POST /api/submit` → `verifyFlag` false → `detectFlagSupplier` (shape gate then HMAC scan) → `recordCheatDetection` (5-step transaction). Response carries `{correct: false, cheat: {...}}`. Hub JS redirects to `/frozen` which renders the cheater takeover from `consumerEvidence(req.player.id)`.
- **Frozen / struck middleware** → `enforcePlayerState` (`middleware/playerAuthMiddleware.ts`) runs after `requirePlayer`. Frozen → `/frozen` (HTML) or `423` (api). Unack'd strikes → one-shot `302 → /strike-notice` for HTML only. JSON never redirects to strike-notice.
- **Player loads a challenge** → `GET /c/:ordinal` (or host-routed subdomain) → `getProgress` lock check → handler renders. The wildcard `GET /c/:ordinal/*` rewrites `req.raw.url` to the puzzle-relative path so handlers see the same shape as subdomain dispatch — this is how challenge sub-paths (`/matrix`, `/robots.txt`, `/sys/console`) work on single-host deploys.
- **Player loads the lobby** → `GET /` → `phaseState()` branches: `uninitialized` → `uninitialized.ejs`; `prelaunch` → `lobby.ejs` (countdown + invites + cohort wall); `live` / `frozen` → both flow through `renderHubLobby` → `hub.ejs` (Focus layout: progress strip, current-task card with submit form, leaderboard rail, hints panel). Frozen swaps the task card for a lights-out panel; if `progress.completed_at` is set, the "the planet is hacked" panel renders instead. The frozen-phase short-circuit on `GET /c/19` reuses the same helper so the per-player flag never enters the response body.
- **Recruit signup** → `GET /recruit` → `POST /recruit` (no pill → render decide page) → `POST /recruit pill=red|blue` → red issues magic link, blue logs `refused`. Pill-choice round-trips alias+email through hidden inputs.
- **Admin first login** → 5-click empty-fields easter egg → `bootstrapPassword` → session + redirect to `/admin/setup`. See invariant #6 + #7.
- **Operator issues an invitation** → `POST /lobby/invite` → `createInvitation` (transactional sweep+quota) → `events.invite_sent` → `mail.send` (or surface `dev_link` if mail offline) → `303 → /?msg=invited`.
- **Invitee claims a slot** → `GET /claim/:token` → `POST /claim/:token` → `claimInvitation` → `findOrCreateUser` → mint `PLAYER_COOKIE` → emit `signup` + `invite_claimed` events → dispatch accept-confirm email (best-effort) → redirect to `/`. Dead links render `claim-dead.ejs`.
- **Admin recovers a flagged player** → drawer's INTEGRITY panel (rendered in `web/static/admin.js` when `cheatStrikes > 0` or `frozen_at`). Two separate POSTs: `/admin/api/player/:id/unfreeze` and `/admin/api/player/:id/clear-strikes`. Audit logs `player_unfreeze` / `player_clear_strikes`.
- **Admin edits email + lobby copy** → `/admin/players?tab=emails` is the single workspace. Six email families + lobby flavor → one POST to `/admin/players/templates`. Each card has live preview, server-rendered `[ preview ]` (same code path as real sends), and `[ send test ]` to admin email. `/admin/setup?section=content` 302s here.
- **Admin JSON API auth** → `/admin/api/*` returns `401 {error: 'unauthorized'}` (vs `302 → /admin/login` for HTML). Gate is in `routes/admin/dashboard.ts` plugin's `preHandler`.
- **Admin password rotation** → `POST /admin/account/password` → `changePassword` → `destroyOtherSessions(email, currentSid)`. All other admin sessions invalidated.
- **Cookie consent banner** → `server.ts` `onSend` hook splices `<link>` + `<script>` for `/static/consent.{css,js}` before `</body>` on every `text/html` public response (skips URLs starting with `/admin`, `/api`, `/static`, `/auth`). Reads `process.env.CLARITY_PROJECT_ID` per-request and seeds `window.__zdConsent.clarityId`, so the client-side gate in `consent.js` loads Microsoft Clarity only after the visitor clicks Accept. Consent state lives in `localStorage.zd_cookie_consent` — nothing per-visitor is stored server-side. Cloudflare Web Analytics is edge-injected and runs regardless; the banner/privacy page disclose this.
- **Privacy page** → `GET /privacy` → `privacy.ejs`. Static disclosure of auth cookies + Clarity + CF Web Analytics with a "Reset consent" button that calls `window.__zdConsent.reset()`.

---

## Schema gotchas

- `users.flag_salt` is set at creation. **Never re-roll it for an existing user** — every flag they've ever seen becomes invalid.
- `user_progress` auto-creates on first login (`ensureProgress.run` in `consumeMagicLinkToken` and `findOrCreateUser`). New users start at `current_ordinal=1`.
- `solves` PK is `(user_id, challenge_id)`. `INSERT OR IGNORE` is safe.
- `attempts` is append-only; every submit writes a row (used for anti-cheat audits).
- `events` is the source of truth for the admin live feed. Insert one row per significant action. Vocabulary: `attempt`, `solve`, `admin_skip`, `signup`, `login`, `refused`, `drip_queued`, `invite_sent`, `invite_claimed`, `invite_revoked`, `invite_expired`, `invite_request_sent`, `cheat_detected`. Dashboard polls `GET /admin/api/events?since=:lastId` every 5s.
- `admin_audit_log` is separate from `events` — admin actions only, with email + IP. Vocabulary: `login`, `login_fail`, `set_password`, `set_password_fail`, `config_change`, `skip`, `send_hint`, `send_test_mail`, `magic_link_sent`, `magic_link_fail`, `session_revoke`, `invite_send`, `invite_revoke`, `request_approve`, `request_deny`, `player_unfreeze`, `player_clear_strikes`, `admin_reset_via_env` (boot-time reset, `email='system'`, `ip=null`, payload carries `{nonce, previousNonce}`).
- Several columns were added via additive `ALTER TABLE` in `migrate.ts` (`addColumnIfMissing`): `admin_sessions.ip/user_agent`, `hints_sent.body`, `users.frozen_at/frozen_reason/cheat_strikes`, `cheat_strikes.submitted_flag/consumer_ip/consumer_ua`, `invitations.inviter_alias_override`. Old DBs auto-migrate on next `npm run migrate`.
- `invitations.inviter_id` is **nullable** (additive migration `dropInviterIdNotNull` rebuilds the table on old DBs) so admin can issue unattributed `admin_override` invitations when no operators exist yet. `inviterDisplayAlias()` in `lib/invitations.ts` is the single source of truth for "what name do we show?" — override → user lookup → fallback. The `listAll` join uses `COALESCE(inviter_alias_override, u.alias)`.
- `invite_requests` enforces "at most one pending per requester" inside the `createRequest` transaction. Approval calls `createInvitation({source: 'admin_grant', bypassQuota: true})` and back-links via `granted_invitation_id`.
- `cheat_strikes` is queue-like, indexed on `(supplier_id, acknowledged_at)`. The `submitted_flag/consumer_ip/consumer_ua` columns feed the `/frozen` evidence panel via `consumerEvidence`. The supplier dossier on `/strike-notice` is built by `supplierDossier`.
- `hints_sent.body` is NULL on rows pre-dating the column. Audit-log payload carries `customized: boolean` + `bodyLen: number` so trust audits distinguish canned-vs-edited dispatches without reading the row body. Hint cost curve + labels live in `lib/hints.ts`.

---

## Testing

- vitest 4, `pool: 'forks'`, `isolate: true` — each test file gets fresh module state and its own DB.
- `app/test/setup.ts` is a `setupFiles` entry that sets `DB_PATH` to a tmpdir and applies the schema *before* any test module under test imports.
- `app/test/helpers.ts:applySchema` is a no-op stub kept for ergonomics.
- Use `await build()` from `app/src/server.ts` and `app.inject({...})`. **Always include `'content-type': 'application/x-www-form-urlencoded'`** when injecting a form-encoded payload — `@fastify/formbody` returns 415 otherwise.
- DB state persists across tests within the same file. For isolation, write tests that create fresh users with unique emails (existing tests do this).

---

## House conventions

- ES modules everywhere. `.js` import extensions in TS source — `moduleResolution: "bundler"` + Node ESM resolves them at runtime.
- Comments favor the **why**, not the what. Read `lib/cheat.ts`, `lib/invitations.ts`, or `routes/submit.ts` for house style. The CRT-aesthetic strings in views are intentional flavor; leave them alone.
- DB writes go through `db.prepare(...)` once at module load, then `.run(...)` per call. **No template-string queries.**
- Routes register in `server.ts` via `app.register(...)`. Each route file exports `(app: FastifyInstance) => void`.
- `phase()` is the only correct way to ask "what state is the game in?"

---

## Responding to PR feedback

**When you fix a bug raised in a PR comment or review, always reply on the same thread to close the loop.** Silent fixes look like the feedback was ignored — even when the diff is up.

- For inline review comments: use `add_reply_to_pull_request_comment` so the reply is threaded under the original.
- For top-level PR comments: use `add_issue_comment`.
- The reply must include: (1) the commit SHA that contains the fix, (2) a one-sentence summary of *what* was changed and *why* it addresses the comment, and (3) confirmation that type-check and tests still pass (or call out anything that didn't).
- Keep it terse — the diff is the primary artifact, the reply is just the receipt.
- If you decide a comment shouldn't be acted on (out of scope, factually wrong, design-intentional), still reply, with the reasoning. Don't leave it hanging.

---

## Documentation pass — required before saying "done"

**Every code change that ships to `dev` must include a documentation pass.** Stale docs are worse than no docs.

1. Walk this checklist. Each line is trigger → file:
   - New table / column / migration → "Schema gotchas" above.
   - New audit-log action / event kind → vocabulary lists in "Schema gotchas".
   - New `app_settings` key → `lib/settings.ts:SettingKey` union (the source of truth — *not* this file).
   - New invariant the system relies on → "Invariants" section above.
   - New route on `/admin/*` → "Common code paths" above + `docs/operator.md`.
   - New env var or runtime secret → `docs/operator.md` "Boot" + `.env.example`.
   - New file under `web/static/` or `web/views/` → `README.md` layout block.
   - New top-level workflow / branch convention → "Branch flow" above.

2. Re-read the relevant doc end-to-end before commit. Stale claims (file lists, route paths, vocab lists) are the most common rot.

3. State doc impact in the PR body. Either link the doc lines you touched, or write `Docs: no impact (internal refactor)`.

4. **The doc pass is part of the work, not a follow-up.** A PR shipping a feature without updating the docs that describe it should fail review. Do not say "done" until step 1's checklist is walked.

---

## What hasn't been built

- **All three GIBSON key parts are wired and the finale consumes them.** `lib/gibson.ts:GIBSON_KEY_PARTS` carries real 16-hex values for parts 1 (#7 matryoshka), 2 (#13 ports-of-call), and 3 (#17 stego-static); `handlers/hack-the-planet.ts` (#19) reconstructs the 24-byte AES-192 key from the concatenation, derives a per-user CBC IV from `flag_salt`, and decrypts a per-player welcome plaintext server-side after validating each fragment individually. The `/admin/setup` review reads `gibsonKeyStatus()` and reports live count automatically — no manual edit.
- **Open signup is still on.** `/recruit` accepts unsolicited signups end-to-end. The PR2 invitation backend is live alongside it. Closing `/recruit` to route all new operators through invitations is a deliberate later PR.
- **Cohort matrix view.** `/admin/players` ships with the table view; the matrix toggle from the design is deferred — controls are absent rather than dimmed.
