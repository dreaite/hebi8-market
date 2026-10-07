#!/usr/bin/env bash
# Deploy a branch to the live instance: back up, fast-forward master, build, restart, push.
# Usage: scripts/deploy.sh <branch-or-commit>
# Rolls back to the previous commit when the build or the health check fails.
# Everything runs inside main(), so bash has read the whole file before the merge can change it.
set -euo pipefail

main() {
  local live=${HEBI8_LIVE:-$HOME/dev/hebi8-market}
  local unit=${HEBI8_UNIT:-hebi8-market}
  local health=${HEBI8_HEALTH_URL:-http://100.92.194.31:8808/}
  local secrets=${HEBI8_SECRETS:-$HOME/.config/hebi8/market}
  local ref=${1:?usage: deploy.sh <branch-or-commit>}

  cd "$live"
  [[ $(git branch --show-current) == master ]] || fail "the live checkout is not on master"
  [[ -z $(git status --porcelain) ]] || fail "the live checkout has local changes"
  git merge-base --is-ancestor HEAD "$ref" || fail "$ref is not a fast-forward of master; rebase it onto master first"

  local prev ts backup
  prev=$(git rev-parse HEAD)
  ts=$(date +%Y%m%d-%H%M%S)
  backup=$HOME/backups/hebi8/$ts-deploy
  mkdir -p "$backup"
  cp -a vault "$backup/vault"
  cp -a "$secrets" "$backup/secrets"
  node -e "new (require('better-sqlite3'))('data/hebi8.db', { readonly: true }).backup(process.argv[1])" "$backup/hebi8.db"
  echo "backup: $backup"

  git merge --ff-only "$ref"
  echo "master: $(git log --oneline -1)"
  if build_and_start "$prev" "$unit" "$health" "$ts"; then
    git push origin master
    echo "deployed $(git rev-parse --short HEAD)"
    return
  fi

  echo "deploy failed; rolling back to ${prev:0:7}" >&2
  git reset --hard "$prev"
  build_and_start "$(git rev-parse HEAD@{1})" "$unit" "$health" "$ts" || echo "rollback failed too; the service needs a look" >&2
  exit 1
}

# Installs dependencies when the lockfile moved since <from>, rebuilds and restarts, then checks the page.
build_and_start() {
  local from=$1 unit=$2 health=$3 ts=$4
  systemctl --user stop "$unit"
  # a stale .next/dev from an old `next dev` breaks the production typecheck
  if [[ -d .next/dev ]]; then mv .next/dev "/tmp/hebi8-next-dev-$ts-$RANDOM"; fi
  if ! git diff --quiet "$from" HEAD -- package-lock.json; then npm ci || return 1; fi
  npm run build || return 1
  systemctl --user start "$unit"
  local i
  for i in {1..20}; do
    if [[ $(curl -s -o /dev/null -w '%{http_code}' "$health") == 200 ]]; then return 0; fi
    sleep 1
  done
  return 1
}

fail() {
  echo "deploy.sh: $1" >&2
  exit 1
}

main "$@"
