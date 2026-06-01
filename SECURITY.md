# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public GitHub issue or PR for anything you suspect could be exploited.

Email: **ZeroDay@fubar.cyou**

Include enough detail to reproduce (a minimal repro repo, request/response sample, or stack trace is ideal). If you'd like to coordinate disclosure timing, say so in the first message — the default is "fix first, disclose after a fix ships".

I aim to acknowledge reports within **72 hours** and to land a fix or mitigation within **14 days** for high-severity issues. Lower-severity findings are tracked but may take longer.

## Scope

In-scope:

- The application code in this repository (Fastify server, route handlers, challenge handlers, libraries under `app/src/lib/`).
- The default deployment topology described in `docs/operator.md` and `docs/hosting-railway.md`.
- The anti-cheat / strike / freeze flow described in `CLAUDE.md` invariants #1–#3 and #12–#13.

Out of scope:

- Vulnerabilities in third-party services (Resend, Cloudflare, Railway, Microsoft Clarity). Report those to the vendor.
- Issues that require attacker-controlled access to the host's infrastructure env vars (e.g. `RESET_ADMIN`). The boot-time reset path is documented as deliberately accepting that trust model.
- Social-engineering attacks against operators or players.
- Self-XSS or denial-of-self.
- Findings against the challenge puzzles themselves — the puzzles are intentionally vulnerable surfaces. The platform around them (auth, progress, flag generation, anti-cheat) is in scope; the challenges' own intentional weaknesses are not.

## Supported versions

Active development happens on `dev`; `main` tracks the latest released build. Security fixes are applied to `dev` and promoted to `main`. There is no separate maintenance branch — older revisions are not patched.
