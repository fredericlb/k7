# The engine on a Raspberry Pi — `engine/docker/Dockerfile.pi`

A Pi runs the same supervisor and engine as any musician's machine, as the command-line engine in a
container, listed at a k7 instance and driven through its relay like any other
(`docs/server-engine.md` for the server's own, which this image is a sibling of). What makes it a
Pi image rather than the server's built for arm64 is the sound: a Pi has a real card, and a guitar
is played through it.

## What a Pi 3 can carry

One amp, and only a light one. The engine runs a NAM model in fixed blocks at the model's rate,
on one core (`engine/k7-runtime/docs/namPlugin.md`), and a Pi 3's A53 is in-order at 1.2 GHz: a
"standard" WaveNet `.nam` does not keep up, a feather or nano one does, and an AIDA-X or Proteus
model (RTNeural) is the comfortable choice. Run the interface at the model's rate, 48 kHz for most:
otherwise the rate bridge adds a resampler in each direction to a CPU that has no room for it. The
OS must be the 64-bit Pi OS — the image is arm64 only.

## Choices

| choice | why |
|---|---|
| built on an arm64 machine, not on the Pi | the engine is Tracktion, JUCE, sfizz, Surge, Faust and Eigen; on 1 GB of RAM a unity file swaps for hours. An Apple Silicon Mac builds `linux/arm64` natively. |
| `-mcpu=cortex-a53` | schedules for the Pi 3's in-order core, where Eigen's inner loops gain most; the instructions stay ARMv8.0, so a Pi 4 or 5 runs the same image. No `-march=native` anywhere, which would have built for the build machine. |
| ALSA straight to the card, no PulseAudio | the server image needs Pulse for a clock it lacks; a Pi has a card, and a sound server in between is latency and CPU on the one machine that has neither to spare. |
| `type hw`, not `plughw` | a rate the card refuses fails loudly in the log instead of costing a resampler. |
| the first card that is not the Pi's own | the onboard jack has no input, and HDMI none either; `K7_ALSA_CARD` overrides. |
| `network_mode: host` | the heartbeat lists the Pi's own addresses rather than a bridge network's. |
| `rtprio`, `memlock`, `SYS_NICE` | real-time scheduling for the audio thread, which a container refuses by default and an A53 cannot do without. |
| no instruments by default | the sampled instruments are gigabytes, on an SD card; `STUDIO_INSTRUMENTS=all` keeps them all. |
| a Dockerfile of its own, its build stage a copy of the server's | its cache mounts carry ids of their own, so one builder making both images never links x86 objects into an arm64 binary; changing the server's would have invalidated its registry cache. |

## Build and install

```bash
# on the Mac, from the repo root
docker build --platform linux/arm64 -f engine/docker/Dockerfile.pi -t k7-runtime-pi .
docker save k7-runtime-pi | gzip > k7-runtime-pi.tar.gz
scp k7-runtime-pi.tar.gz engine/docker/docker-compose.pi.yml pi@raspberrypi.local:

# on the Pi
gunzip -c k7-runtime-pi.tar.gz | docker load
ENGINE_REGISTRY_URL=https://st0.app docker compose -f docker-compose.pi.yml up -d
docker compose -f docker-compose.pi.yml logs -f   # "ALSA default is card '…'", then the engine's [device] line
```
