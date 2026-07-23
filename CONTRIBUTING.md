# Contributing

Thanks for helping improve ZeroDay. This repository contains both an
application platform and intentionally vulnerable challenge surfaces, so
please distinguish platform bugs from puzzle behavior before filing an issue.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow
[`SECURITY.md`](SECURITY.md) and report it privately instead.

## Development setup

You need:

- Node.js 24 LTS (CI currently uses 24.18.0)
- the npm version bundled with Node.js
- Python 3, `make`, and a C++ compiler for the native Argon2 and SQLite modules

Then:

```bash
git clone https://github.com/atk0309/project_ZeroDay.git
cd project_ZeroDay
git switch dev
npm ci
npm run check
npm run build
```

Docker is an alternative when you do not want to install the native build
toolchain locally.

## Branch and pull-request flow

1. Create a short-lived branch from `dev`.
2. Keep the change focused and add or update tests.
3. Run `npm run check`, `npm run build`, and `npm run audit`.
4. Update documentation when behavior, configuration, routes, or operational
   steps change.
5. Open the pull request against `dev`, not `main`.

`main` is the production branch. Changes reach it through a separate promotion
pull request from `dev`.

## Project conventions

- Read [`CLAUDE.md`](CLAUDE.md) before changing authentication, progression,
  flags, phase handling, invitations, or admin routes. Its invariants are
  load-bearing.
- Keep SQLite writes parameterized and transactional where the surrounding
  code is transactional.
- Never commit real credentials, database files, player data, or production
  secrets.
- Challenge weaknesses are often deliberate. Tests should preserve the puzzle
  while protecting the platform around it.
