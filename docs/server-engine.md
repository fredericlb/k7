# The server's engine — `k7-runtime`, the third studio image

A hosted k7 runs one engine of its own, beside k7 in `docker/docker-compose.yml` (the `engine`
service), built from `engine/docker/Dockerfile`. An account with no machine of its own can play a
song and listen through the broadcast (`engine/k7-runtime/docs/broadcast.md`) without installing
anything, and every render k7 cannot make itself is made here.

## It is one more machine, not a part of k7

The container runs the same supervisor and the same engine as the desktop builds, and the
supervisor reaches k7 the way every musician's machine does: it heartbeats to the registry and
dials the tunnel (`packages/engine-tunnel/docs/tunnel.md`), at `http://k7:8789` on the container
network. Nothing in k7 knows this engine is local to it:

- **no second path into an engine.** The relay, the claims, the jobs and the local copy of a project
  are the ones every machine goes through, so the server's engine tests them rather than bypassing
  them;
- **a crashing plugin takes down a container, not the studio.** The engine restarts under its
  supervisor, and k7, its file services and the workspaces stay up;
- **it ships on its own.** A frontend change does not rebuild the C++, and the C++ does not rebuild
  k7's image.

It publishes no port. Browsers reach it through k7's relay; the LAN addresses its heartbeat lists
are the container's, which no browser can reach, and the picker falls back to the relay as it does
for any machine behind a NAT.

Like every engine a registry lists, every account sees it, and the claim rules decide who plays
on it at a given moment (`packages/engine-registry/docs/claim.md`): one account at a time.

## The audio device is a PulseAudio null sink

The engine opens ALSA's default device and never chooses one itself
(`engine/k7-runtime/docs/audioDevice.md`). A server has no sound card, and an engine with no output
open has no audio callback: the transport says it is playing and the playhead never moves. So the
container needs a device that consumes audio at real-time speed:

| option | why not / why |
|---|---|
| ALSA's `null` plugin | accepts every write at once, so it is no clock at all |
| `snd-aloop` | a kernel module, to be loaded on the HOST: a deployment requirement outside the compose file |
| JACK's dummy driver | real time, but JUCE's JACK backend is not compiled in (`JUCE_JACK`), so it would mean an engine change |
| **PulseAudio, `module-null-sink`** | a timer-driven sink, reached through ALSA's `pulse` plugin by the engine as built — no engine change |

`engine/docker/asound.conf` makes `pulse` ALSA's default, and the entrypoint starts PulseAudio with
the one sink at 48 kHz before the supervisor. The ALSA→Pulse hop adds buffering, which costs
monitoring latency, and nobody monitors on a server.

## What it plays is heard in the browser

The null sink only keeps time. The sound reaches the person through the engine's master
**broadcast** (`engine/k7-runtime/docs/broadcast.md`), and they never ask for it: the image sets
`STUDIO_AUDIO_TO_BROWSER=1`, the engine answers `whoami` with `audioToBrowser: true`, and every page
that drives it subscribes and plays the frames through an AudioWorklet
(`packages/engine-browser/src/engineOutput.ts`). Today those pages are the editor and the
médiathèque's engine destination.

The flag comes from the ENGINE and not from the registry, so a page needs no idea which machine is the
server's. The same pages driving a musician's engine hear its speakers, and their browser stays
silent. It is an image setting rather than a compose one because this image exists only for an
engine nobody can hear.

Three costs come with it:

- **Bandwidth.** The broadcast is uncompressed float32, about 3 Mbit/s per listener, which is
  comfortable on a LAN and heavy over the internet. The frame header already carries a codec byte
  for Opus (`packages/engine-browser/docs/streaming.md`).
- **Latency.** A transport press makes its round trip, then the worklet waits for its 150 ms cushion
  before it plays. Fine for playback; not for playing an instrument through the server's engine.
- **The first sound waits for a click.** A browser lets an AudioContext built without a gesture stay
  silent, so the context resumes on the page's next pointer or key press. Pressing play is one.

## The supervisor runs as the command-line engine

The entrypoint runs `k7-supervisor --config $STUDIO_HOME/engine.json`, the same mode a musician runs
from a terminal (`engine/k7-supervisor/docs/supervisor.md`): no app holds its stdin, so it must not
be the mode that stops when stdin closes. The file lives in the `engine-home` volume and is created as
`{}` on the first start; everything this page sets is environment, which the file overrides only for
the keys it names. `docker stop` sends SIGTERM through tini, and the supervisor deregisters on it. It
writes nothing to stdout; its diagnostics go to stderr, which is the container's log.

## Instruments

`STUDIO_INSTRUMENTS=all`: the server has no Downloads tab to choose instruments in, so it keeps all of
them, like the desktop app (`engine/k7-supervisor/docs/instruments.md`). The first start downloads
them into the `engine-home` volume, which keeps them across restarts. Set `ENGINE_INSTRUMENTS` to
anything else to keep none.

## The build

Debian, like the desktop job's Linux leg, with the same packages; the runtime is `bookworm-slim`
and must stay glibc. k7's image is Alpine and could not load these binaries. A `ldd` check in the
runtime stage fails the build when a library the binaries link is missing, so the failure shows up
at build time and not when the engine first starts.

The compile is one `RUN`, with the two build folders and ccache as cache mounts: staging reads the
Faust libraries out of the engine's build folder, which exists only inside that step. The step copies
only `engine/k7-runtime`, `engine/k7-supervisor` and the staging script, so a push that touches none
of them finds the compile in the registry cache (`cache:k7-runtime`, as `docs/images.md` describes
for k7). A cold build is long enough to have its own OneDev job, `build engine image`, with a
three-hour timeout. `publish studio images` waits for it and tags both images with the same stamp,
which is why the compose file names both images by `APP_VERSION`.

## It is k7's render machine

k7's image keeps no engine binary, so an export, a share, a freeze or any other render a file
service makes goes to an engine's machine (`packages/file-service/docs/render.md`). When the
account's own engine is bound it goes there; otherwise it comes here. The container is recognised
by `RENDER_KEY` in `docker/.env.example`, which compose hands to both k7 and the engine as
`STUDIO_RENDER_KEY`. The engine's token cannot serve, because every socket that drives the engine
learns it (`packages/engine-tunnel/docs/jobs.md`). Unset, there is no render machine, and a render
with no bound engine says that there is no engine to render with.

The supervisor sends the key to every registry it dials, so this container must dial k7 alone:
`STUDIO_REGISTRY_URL` names one registry, and nothing else should be added to its settings.

What does not render here is what is not a render. Decoding a clip for its waveform, measuring a
file's peak and dumping a plugin's parameters are other modes of the engine binary, and they still
run only where the file service has one.
