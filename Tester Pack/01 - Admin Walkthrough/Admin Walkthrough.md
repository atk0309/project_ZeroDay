# 01 — Admin Walkthrough

What to watch on the `/admin` console while a player solves. Use this to sanity-check that solves register, hints fire, and the integrity panel surfaces strikes correctly.

---

## Dashboards

`/admin` has two layouts (cookie-toggle in the top chip strip):

- **A — Dense ops**: KPI strip → players grid → side rail (live feed, stuck queue).
- **B — Narrative**: phase hero + countdown → top-of-pack + needs-attention cards → cohort funnel → live feed.

Either works for testing. The dense view is faster for scanning multiple solves; the narrative view matches the player's mental model better.

---

## Players grid

- **Search**: `/admin?q=<alias-or-email>` — substring match.
- **Stuck only**: `/admin?stuck=1` — players who've been on their current ordinal >20 hours.
- **Columns**: alias · 19-cell progress bar (current cell highlighted, ⚠ on admin skips) · solves · hints · skips · last advance.
- **Row actions**:
  - `[ open ]` → JSON drawer (player details).
  - `[ hint ▾ ]` → L1–L5 dropdown to dispatch a hint email.
  - `[ skip ]` → admin-skip past the current stage (logs `admin_skip` event + `⚠` mark).

---

## Player detail drawer

Click any row's `[ open ]`. The drawer fetches `GET /admin/api/player/:id` and renders:

- **Identity**: alias, email, current ordinal, solves, attempts, hints, skips, time-on-stage, last advance, flag-salt prefix.
- **Progress map**: all 19 cells with solved/current/skipped state.
- **Last 10 attempts**: submitted flag (truncated), timestamp, correct/wrong.
- **Footer actions**: send hint (L1–L5), admin-skip, resend magic link.

### INTEGRITY panel

Only renders when the player has `cheat_strikes > 0` OR `frozen_at != null`. Two **independent** buttons:

| Button | Endpoint | Effect |
|--------|----------|--------|
| `unfreeze` | `POST /admin/api/player/:id/unfreeze` | Clears `frozen_at`, audit-logs `player_unfreeze`. |
| `clear-strikes` | `POST /admin/api/player/:id/clear-strikes` | Resets strike counter to 0, clears the unack'd `cheat_strikes` queue rows, audit-logs `player_clear_strikes`. |

The two are intentionally separate — you can drop a strike-1 without unfreezing a strike-2 player.

---

## Live feed (events)

Auto-polls `GET /admin/api/events?since=<lastId>` every 5 s. New events flash 🔆.

Event vocabulary you'll see during normal testing:

| Kind | Meaning |
|------|---------|
| `signup` | Player completed `/recruit` red pill. |
| `login` | Player consumed magic link. |
| `attempt` | Wrong flag submitted (honest miss). |
| `solve` | Correct flag accepted; ordinal advanced. |
| `admin_skip` | Admin moved a player past their current stage. |
| `cheat_detected` | Submitted flag matched another op's flag → strike pipeline fired. |
| `refused` | `/recruit` blue pill chosen. |
| `drip_queued` | Daily 09:00 UTC cron flagged this player as stuck. |
| `invite_sent`, `invite_claimed`, `invite_revoked`, `invite_expired`, `invite_request_sent` | Operator invitation flow. |

If your test player solves a challenge and you don't see a `solve` event within 5 s, the submit didn't go through. Check the response of the `POST /api/submit` call.

---

## Hint dispatch

L1–L5 hints with cost curve in `lib/hints.ts`:

| Level | Cost | Tone |
|-------|-----:|------|
| L1 | -1 | nudge ("there's a name we don't want spoken") |
| L2 | -2 | direction ("robots are honest…") |
| L3 | -4 | technique ("redaction is a render trick…") |
| L4 | -7 | strong ("view-source on /staff") |
| L5 | -10 | near-spoiler (literal solve URL) |

Per-challenge hint text is hardcoded in each handler (`hints.hint1` … `hints.hint5`). The admin UI shows a preview of the canned text plus an editable body — both go in `hints_sent.body`. Audit log records `customized: bool` + `bodyLen: number`.

When you send a hint, three things happen:
1. `hints_sent` row inserted (one per dispatch).
2. Email sent (or surfaced as `dev_link` if mail is offline).
3. `admin_audit_log` row with `action='send_hint'`.

---

## Audit log

Separate from the events feed. Captures admin actions only (with email + IP):

`login`, `login_fail`, `set_password`, `set_password_fail`, `config_change`, `skip`, `send_hint`, `send_test_mail`, `magic_link_sent`, `magic_link_fail`, `session_revoke`, `invite_send`, `invite_revoke`, `request_approve`, `request_deny`, `player_unfreeze`, `player_clear_strikes`.

Every action you take in `/admin/*` should produce a row here.

---

## Templates workspace (`/admin/players?tab=emails`)

Six email families + lobby flavor, each with subject + body, live preview, server-render preview, and `[ send test ]` to admin email.

Token placeholders (resolved server-side via `lib/content.ts`):
- `{alias}`, `{magic_link}`, `{expires_in}`, `{claim_link}`, `{inviter_alias}`, `{note}`, etc.

For tester runs, leave defaults — they're seeded by `lib/content.ts:seedDefaults()` only when the row is literal-`null`. An empty string means "operator deliberately cleared it; leave alone".

To force re-seed: `UPDATE app_settings SET value=NULL WHERE key='<key>'; restart server`.

---

## Quick verification flow

After a player solves challenge #1:

1. **Live feed** should flash a `solve` event with `payload.challenge_id='white-rabbit'`.
2. **Players grid** should show their progress bar with cell 1 solved, cell 2 highlighted as current.
3. **Player drawer**: ordinal=2, solves=1, last 10 attempts shows the correct submission.
4. **Audit log**: nothing — only admin actions log there.

If any of those four don't match, something failed silently. Check the server logs (the `npm run dev` terminal).
