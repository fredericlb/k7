#!/bin/sh
# pi-entrypoint.sh — the Pi engine container's start: ALSA's default pointed at the sound card, then the supervisor.
# The card is $K7_ALSA_CARD when set, else the first card that is not the Pi's own HDMI or headphone jack. docs/pi-engine.md.
set -eu

card="${K7_ALSA_CARD:-}"
if [ -z "$card" ] && [ -r /proc/asound/cards ]; then
  # Lines read " 1 [CODEC          ]: USB-Audio - USB Audio CODEC"; the id is the bracketed word.
  card=$(sed -n 's/^ *[0-9][0-9]* \[\([^ ]*\) *\]: \(.*\)$/\1 \2/p' /proc/asound/cards \
    | grep -viE 'bcm2835|vc4-?hdmi|vc4hdmi' | head -n 1 | cut -d' ' -f1)
fi
if [ -z "$card" ]; then
  echo "k7-runtime: no sound card in /proc/asound/cards — is /dev/snd passed to the container?" >&2
  exit 1
fi

# hw and not plughw: a rate the card refuses must fail where it is seen, not cost a resampler on an A53.
cat > "$HOME/.asoundrc" <<EOF
pcm.!default { type hw card "$card" }
ctl.!default { type hw card "$card" }
EOF
echo "k7-runtime: ALSA default is card '$card'" >&2

config="$STUDIO_HOME/engine.json"
[ -f "$config" ] || echo '{}' > "$config"
# Diagnostics are on stderr, the container's log; SIGTERM from tini is what stops it.
exec /opt/k7/k7-supervisor --config "$config"
