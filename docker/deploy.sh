#!/usr/bin/env bash
# deploy.sh — moves the hosted stack to another build and back if it does not come up: sets APP_VERSION in
# .env, pulls, restarts, then waits for k7's /api/ready; on a timeout it restores the previous APP_VERSION
# and restarts on it. Run on the deploy host, beside docker-compose.yml and .env.
# The rollback restores the IMAGES only, never the volumes: see docs/images.md, "Deploying, and rolling back".
#
#   ./deploy.sh 0.4.2           # a release tag, or a stamp, or a commit
#   READY_TIMEOUT=300 ./deploy.sh 26.10311200
set -euo pipefail

cd "$(dirname "$0")"
next=${1:?usage: deploy.sh <APP_VERSION>}
env_file=${ENV_FILE:-.env}
timeout=${READY_TIMEOUT:-180}

[ -f "$env_file" ] || { echo "no $env_file beside docker-compose.yml — copy .env.example" >&2; exit 2; }

# The value before this deploy; empty means the release docker-compose.yml names.
prev=$(sed -n 's/^APP_VERSION=//p' "$env_file" | tail -n 1)

set_version() {
  local tmp
  tmp=$(mktemp)
  awk -v v="$1" '/^APP_VERSION=/ { print "APP_VERSION=" v; done = 1; next } { print } END { if (!done) print "APP_VERSION=" v }' "$env_file" >"$tmp"
  # Written through, not moved: .env keeps its owner and its mode, which hold secrets.
  cat "$tmp" >"$env_file"
  rm -f "$tmp"
}

ready() {
  local until=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$until" ]; do
    if docker compose exec -T k7 wget -qO- http://127.0.0.1:8789/api/ready >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

echo "deploying APP_VERSION=$next (was: ${prev:-the compose default})"
set_version "$next"
if ! docker compose pull k7 engine; then
  echo "pull failed — APP_VERSION left at ${prev:-the compose default}" >&2
  set_version "$prev"
  exit 1
fi
# `up` itself fails when k7 turns unhealthy, the engine waiting on it: the check below decides either way.
docker compose up -d || true
if ready; then
  echo "k7 is ready on $next"
  exit 0
fi

echo "k7 not ready after ${timeout}s on $next — rolling back to ${prev:-the compose default}" >&2
docker compose logs --tail 80 k7 >&2 || true
set_version "$prev"
docker compose up -d || true
if ready; then
  echo "rolled back: k7 is ready on ${prev:-the compose default}" >&2
else
  echo "the rollback is not ready either — see docs/images.md, \"Deploying, and rolling back\"" >&2
fi
exit 1
