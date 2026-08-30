#!/bin/sh
# Launches the four studio backends side by side. The base image's entrypoint
# runs this script AS the backend next to nginx and tears both down when either
# exits — so this script's job is to exit as soon as ANY backend dies, letting
# the orchestrator recycle the whole container rather than limp along.
#
# Per-process env is fixed HERE, not passed in, because one container has one
# environment and `PORT` would collide across three of the four. Everything
# else comes from the container environment and is shared by design: one
# SESSION_SECRET (pl8 mints the cookie the others verify), one STUDIO_MEDIATEK,
# one STUDIO_PREFS_DIR — distinct names, so they stay in the Dockerfile.
#
# Two backends run under `tsx` and two under Node's own type stripping, and
# that is not an inconsistency to tidy up: st0 and pl8 import @studio/* as raw
# TypeScript SOURCE out of node_modules, which `--experimental-strip-types`
# refuses to touch. Changing either line to match the other breaks it on the
# first import.
set -u

PIDS=""

spawn() {
  dir=$1
  shift
  (cd "/app/apps/$dir" && exec "$@") &
  PIDS="$PIDS $!"
}

spawn st0/backend  env PORT=8789 /app/node_modules/.bin/tsx src/server.ts
# NODE_OPTIONS and not a flag on the line: `tsx` is the process, and the flag is for the node under it.
# `node:sqlite` is what the shares' comments are kept in, and it is still behind this flag on Node 22
# — the base image's runtime. Accepted as a no-op on 24+, so the bump costs nothing to prepare for.
spawn pl8/backend env PORT=8795 NODE_OPTIONS=--experimental-sqlite /app/node_modules/.bin/tsx src/server.ts
spawn k7/backend  env PORT=8787 node --experimental-strip-types --env-file-if-exists=.env src/server.ts
# EXTRA_FLAGS passes CLI flags to z0's server (e.g. `--latest`); unset is none.
spawn z0/backend  env BACKEND_PORT=8080 node --experimental-strip-types src/server.ts ${EXTRA_FLAGS:-}

trap 'kill $PIDS 2>/dev/null' TERM INT EXIT

# busybox ash has no reliable `wait -n`: poll instead. Two seconds of lag on a
# crash is nothing next to the container restart it triggers.
while :; do
  for p in $PIDS; do
    if ! kill -0 "$p" 2>/dev/null; then
      echo "run-backends: pid $p exited — stopping the container" >&2
      exit 1
    fi
  done
  sleep 2
done
