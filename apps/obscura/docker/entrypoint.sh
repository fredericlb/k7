#!/bin/sh
# Run nginx + the Node backend together. The backend is supervised so a crash
# restarts it without taking the container down; nginx going down brings the
# container down so the orchestrator can recycle it. Solo-only image: sessions
# come from Grist, the server boots straight into the HTTP listener.
set -e

# The backend makes its own audio cache directory now (a per-launch temp dir,
# see src/state.ts), so there's no data tree to prepare here — only /run, which
# holds the stop sentinel below.
mkdir -p /run
rm -f /run/stop

nginx -g 'daemon off;' &
NGINX_PID=$!

(
    while [ ! -f /run/stop ]; do
        # EXTRA_FLAGS: CLI args for the server (e.g. "--latest").
        node --experimental-strip-types src/server.ts $EXTRA_FLAGS &
        SERVER_PID=$!
        echo "$SERVER_PID" > /run/server.pid
        wait "$SERVER_PID" || true
        [ -f /run/stop ] && break
        echo "[entrypoint] server exited, restarting in 1s..."
        sleep 1
    done
) &
SUPERVISOR_PID=$!

term() {
    touch /run/stop
    [ -f /run/server.pid ] && kill -TERM "$(cat /run/server.pid)" 2>/dev/null || true
    kill -TERM "$NGINX_PID" 2>/dev/null || true
}
trap term TERM INT

wait "$NGINX_PID"
touch /run/stop
[ -f /run/server.pid ] && kill -TERM "$(cat /run/server.pid)" 2>/dev/null || true
wait "$SUPERVISOR_PID" 2>/dev/null || true
