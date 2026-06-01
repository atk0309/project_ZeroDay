#!/usr/bin/env bash
# ZeroDay challenge #16 (git-archaeology) — authoring helper.
#
# Plants the canonical secret in a fresh repo's history and "fixes" it in a
# later commit *without* rewriting history. The blob from the planted commit
# stays reachable via `git log -p` and `git log -- deploy.sh` — that's the
# whole puzzle.
#
# Run once at authoring time:
#
#   ZERODAY_SEED_SECRET='ZERODAY_DEPLOY_KEY=...' tools/git-seed.sh ./zeroday-seed
#   cd ./zeroday-seed
#   git remote add origin git@github.com:<you>/<repo>.git
#   git push -u origin main
#
# DO NOT `git push --force` after the seed lands — that would erase the planted
# blob and break the puzzle.
set -euo pipefail

if [[ -z "${ZERODAY_SEED_SECRET:-}" ]]; then
  echo "error: set ZERODAY_SEED_SECRET to the canonical secret string." >&2
  echo "example: ZERODAY_SEED_SECRET='ZERODAY_DEPLOY_KEY=<choose-your-own-string>' $0 ./zeroday-seed" >&2
  echo "after planting, sha-256 the same string and put the hex into" >&2
  echo "  app/src/challenges/handlers/git-archaeology.ts (DEFAULT_SECRET_DIGEST_HEX)" >&2
  echo "or set GIT_ARCHAEOLOGY_SECRET_DIGEST in the runtime env to that hex." >&2
  exit 2
fi

target="${1:-./zeroday-seed}"

if [[ -e "$target" ]]; then
  echo "error: $target already exists. choose a fresh path or remove it first." >&2
  exit 1
fi

mkdir -p "$target"
cd "$target"

git init -q -b main
git config user.email "ops@zeroday.example"
git config user.name  "zeroday-ops"

cat > README.md <<'EOF'
# ZeroDay-internal

Internal deploy tooling for the ZeroDay stack. Do not share externally.
EOF
git add README.md
git -c commit.gpgsign=false commit -q -m "chore: initial repo scaffolding"

cat > deploy.sh <<EOF
#!/usr/bin/env bash
# rolls a release out to the gibson cluster.
set -e

# WARNING: do not commit credentials. (we'll move this to vault later.)
${ZERODAY_SEED_SECRET}

curl -fsSL "https://deploy.zeroday.example/roll" -H "x-key: \$ZERODAY_DEPLOY_KEY"
EOF
chmod +x deploy.sh
git add deploy.sh
git -c commit.gpgsign=false commit -q -m "ops: add deploy.sh for the gibson cluster"

# the "fix" — drop the secret from the working tree, but the blob from the
# previous commit is still reachable forever. no --amend, no filter-branch.
cat > deploy.sh <<'EOF'
#!/usr/bin/env bash
# rolls a release out to the gibson cluster.
set -e

# key now sourced from the deploy runner's environment.
curl -fsSL "https://deploy.zeroday.example/roll" -H "x-key: $ZERODAY_DEPLOY_KEY"
EOF
git add deploy.sh
git -c commit.gpgsign=false commit -q -m "fix: stop hardcoding the deploy key in deploy.sh"

digest_hex="$(printf '%s' "$ZERODAY_SEED_SECRET" | shasum -a 256 2>/dev/null | awk '{print $1}')"
if [[ -z "$digest_hex" ]]; then
  digest_hex="$(printf '%s' "$ZERODAY_SEED_SECRET" | sha256sum | awk '{print $1}')"
fi

echo
echo "seed repo ready at: $target"
echo "next:"
echo "  cd $target"
echo "  git remote add origin <your-repo-ssh-url>"
echo "  git push -u origin main           # use --force only on a freshly emptied repo"
echo
echo "then bake the digest of your planted secret into the handler:"
echo "  app/src/challenges/handlers/git-archaeology.ts → DEFAULT_SECRET_DIGEST_HEX ="
echo "    '$digest_hex'"
echo "or set GIT_ARCHAEOLOGY_SECRET_DIGEST=$digest_hex in the runtime env."
echo
echo "verify the puzzle is intact:"
echo "  git log --oneline                # three commits, newest first"
echo "  git log -p -- deploy.sh | grep ZERODAY_DEPLOY_KEY    # the secret line is present in commit #2's diff"
