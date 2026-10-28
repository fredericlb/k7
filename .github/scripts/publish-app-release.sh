#!/usr/bin/env bash
# publish-app-release.sh <api> <stamp> <dir> — every file of <dir> PUT to <api>/<stamp>/<file>, then <api>/<stamp>/publish.
# The one way release.yml and tray.yml publish on /app_downloads (docs/app-downloads.md). images.yml's deploy can
# restart app.k7.rocks mid-publish, so every request waits for the server to answer and is retried.
set -euo pipefail

api=$1 stamp=$2 dir=$3
health="${api%%/api/*}/api/health"
answer=$(mktemp)

# Up to five minutes for a restarting server to answer its liveness route.
up() {
  for _ in $(seq 30); do
    curl -fsS -o /dev/null --max-time 10 "$health" && return 0
    sleep 10
  done
  echo "::error::$health did not answer for five minutes"
  return 1
}

# A refusal the server meant is final; anything else (a 502, a proxy's 404, no answer) is tried again.
send() {
  local code attempt
  for attempt in 1 2 3 4 5; do
    up
    rm -f "$answer"
    code=$(curl -sS -o "$answer" -w '%{http_code}' -H "Authorization: Bearer $APP_RELEASE_TOKEN" "$@" || true)
    cat "$answer" 2>/dev/null || true
    echo
    case "$code" in
      2??) return 0 ;;
      400 | 401 | 413) echo "::error::refused with $code" && return 1 ;;
    esac
    echo "::warning::answered ${code:-nothing} (attempt $attempt of 5), trying again"
    sleep 15
  done
  echo "::error::gave up after five attempts"
  return 1
}

for f in "$dir"/*; do
  echo "uploading $(basename "$f")"
  send -T "$f" "$api/$stamp/$(basename "$f")"
done
send -X POST "$api/$stamp/publish"
