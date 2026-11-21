#!/usr/bin/env node
// Pretest guard: refuse to run tests on a stale feature branch.
//
// Why: feature branches must build on `origin/main` (per CLAUDE.md). A branch
// cut from an older `main` is silently missing whatever has merged since —
// new challenges, refactors, tests, dependency bumps — so local test counts
// and code shape disagree with CI. This script makes the mismatch loud.
//
// Logic:
//   - On `main` (or detached HEAD) → pass (we're not on a feature branch).
//   - In CI (`CI=true`) → pass (CI is allowed to test any ref directly).
//   - Otherwise → fetch origin/main, then verify
//     `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
//     If equal: branch is up to date with main. If not: main has commits we
//     don't, and we exit non-zero with instructions.
//
// Bypass: `CHECK_BASE_SKIP=1 npm test` for one-off cases.

import { execSync } from 'node:child_process';

const BASE = 'main';

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
if (branch === BASE || branch === 'HEAD') {
  process.exit(0);
}

// Best-effort fetch. Network failures are not a hard error — we still want to
// run the comparison against whatever local origin/main we have.
tryRun(`git fetch origin ${BASE} --quiet`);

const baseTip = tryRun(`git rev-parse origin/${BASE}`);
if (!baseTip) {
  console.log(`[check-base] origin/${BASE} not present locally, skipping`);
  process.exit(0);
}
const mergeBase = tryRun(`git merge-base HEAD origin/${BASE}`);
if (mergeBase === baseTip) {
  process.exit(0);
}

const ahead = tryRun(`git rev-list --count ${mergeBase}..origin/${BASE}`);
console.error('');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error(`[check-base] BRANCH ${branch} IS BEHIND origin/${BASE} by ${ahead} commit(s).`);
console.error('');
console.error(`  Feature branches must be built on origin/${BASE} (per CLAUDE.md).`);
console.error('  Running tests now will produce a baseline that disagrees with CI.');
console.error('');
console.error('  Fix:');
console.error(`    git fetch origin ${BASE}`);
console.error(`    git rebase origin/${BASE}`);
console.error('    # resolve any conflicts, then re-run');
console.error('');
console.error('  One-time bypass: CHECK_BASE_SKIP=1 npm test');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error('');
process.exit(1);
