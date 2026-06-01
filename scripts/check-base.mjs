#!/usr/bin/env node
// Pretest guard: refuse to run tests on a stale feature branch.
//
// Why: feature branches must build on `origin/dev` (per CLAUDE.md). When the
// harness gives us a branch cut from `origin/main`, dev-only commits (new
// challenges, refactors, tests) are missing — local test counts and code
// shape silently disagree with CI. This script makes the mismatch loud.
//
// Logic:
//   - On `dev` or `main` → pass (we're not on a feature branch).
//   - In CI (`CI=true`) → pass (CI is allowed to test any ref directly).
//   - Otherwise → fetch origin/dev, then verify
//     `git merge-base HEAD origin/dev` == `git rev-parse origin/dev`.
//     If equal: branch is up to date with dev. If not: dev has commits we
//     don't, and we exit non-zero with instructions.
//
// Bypass: `CHECK_BASE_SKIP=1 npm test` for one-off cases.

import { execSync } from 'node:child_process';

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function tryRun(cmd) {
  try {
    return sh(cmd);
  } catch {
    return null;
  }
}

if (process.env.CHECK_BASE_SKIP === '1') {
  console.log('[check-base] skipped via CHECK_BASE_SKIP=1');
  process.exit(0);
}
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  console.log('[check-base] skipped in CI');
  process.exit(0);
}

const branch = tryRun('git rev-parse --abbrev-ref HEAD');
if (!branch) {
  console.log('[check-base] not a git repo, skipping');
  process.exit(0);
}
if (branch === 'dev' || branch === 'main' || branch === 'HEAD') {
  process.exit(0);
}

// Best-effort fetch. Network failures are not a hard error — we still want to
// run the comparison against whatever local origin/dev we have.
tryRun('git fetch origin dev --quiet');

const devTip = tryRun('git rev-parse origin/dev');
if (!devTip) {
  console.log('[check-base] origin/dev not present locally, skipping');
  process.exit(0);
}
const mergeBase = tryRun(`git merge-base HEAD origin/dev`);
if (mergeBase === devTip) {
  process.exit(0);
}

const ahead = tryRun(`git rev-list --count ${mergeBase}..origin/dev`);
console.error('');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error(`[check-base] BRANCH ${branch} IS BEHIND origin/dev by ${ahead} commit(s).`);
console.error('');
console.error('  Feature branches must be built on origin/dev (per CLAUDE.md).');
console.error('  Running tests now will produce a baseline that disagrees with CI.');
console.error('');
console.error('  Fix:');
console.error('    git fetch origin dev');
console.error('    git rebase origin/dev');
console.error('    # resolve any conflicts, then re-run');
console.error('');
console.error('  One-time bypass: CHECK_BASE_SKIP=1 npm test');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error('');
process.exit(1);
