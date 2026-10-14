#!/bin/sh
# entrypoint.sh — the engine container's start: PulseAudio's null sink, then the supervisor, which starts the engine.
# The supervisor runs as the command-line engine: its config in the home volume, created empty once, and the
# environment for the rest. docs/server-engine.md.
set -eu

mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Daemonized so that tini, not the supervisor, is the parent that reaps it.
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --realtime=false --high-priority=false \
  --log-target=stderr --log-level=warning -n \
  --load="module-null-sink sink_name=k7 rate=48000 channels=2 sink_properties=device.description=k7-server" \
  --load="module-native-protocol-unix"

tries=0
until pactl info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 50 ]; then
    echo "k7-runtime: PulseAudio did not start, so the engine would have no device" >&2
    exit 1
  fi
  sleep 0.1
done

config="$STUDIO_HOME/engine.json"
[ -f "$config" ] || echo '{}' > "$config"
# Diagnostics are on stderr, the container's log; SIGTERM from tini is what stops it.
exec /opt/k7/k7-supervisor --config "$config"
