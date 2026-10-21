# syntax=docker/dockerfile:1
#
# k7-runtime — the engine and its supervisor, for the server: the supervisor dials k7's registry over the
# compose network and is listed beside the musicians' machines. There is no sound card, so the engine
# plays into a PulseAudio null sink, which keeps real time; nobody hears it except through the
# broadcast and the renders. docs/server-engine.md.
#
# Build from the repo root: docker build -f engine/docker/Dockerfile .

# ---- build: the two CMake projects and the script that stages them, nothing else of the repo ----
FROM node:24-bookworm AS build
# The same set as the engine job's Linux leg (.github/workflows/engine-platform.yml), plus ccache.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build ccache git ca-certificates pkg-config python3 \
      libssl-dev \
      libasound2-dev libjack-jackd2-dev libfreetype6-dev libfontconfig1-dev \
      libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev \
      libxrandr-dev libxrender-dev libglu1-mesa-dev mesa-common-dev \
      libcurl4-openssl-dev ladspa-sdk \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY engine/k7-runtime engine/k7-runtime
COPY engine/k7-supervisor engine/k7-supervisor
COPY packages/supervisor-host/scripts packages/supervisor-host/scripts
# Empty is cores − 2: a JUCE or Tracktion unity file takes a gigabyte to compile (engine/k7-runtime/docs/build.md).
ARG BUILD_JOBS=
# Read by the presets into CMAKE_<LANG>_COMPILER_LAUNCHER, which they set and so override from the environment.
ENV STUDIO_COMPILER_LAUNCHER=ccache CCACHE_DIR=/root/.ccache
# One RUN, because staging reads the Faust libraries out of the build folder, which only a cache mount holds.
RUN --mount=type=cache,target=/src/engine/k7-runtime/build,sharing=locked \
    --mount=type=cache,target=/src/engine/k7-supervisor/build,sharing=locked \
    --mount=type=cache,target=/root/.ccache,sharing=locked \
    set -eu; \
    export CMAKE_BUILD_PARALLEL_LEVEL="${BUILD_JOBS:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"; \
    cd /src/engine/k7-runtime; \
    [ -f build/release-gcc/CMakeCache.txt ] || cmake --preset release-gcc -DSTUDIO_BUILD_TESTS=OFF; \
    cmake --build --preset release-gcc; \
    cd /src/engine/k7-supervisor; \
    [ -f build/release-gcc/CMakeCache.txt ] || cmake --preset release-gcc; \
    cmake --build --preset release-gcc --target k7-supervisor; \
    node -e "import('/src/packages/supervisor-host/scripts/stageEngine.mjs').then((m) => m.stageEngine({ repo: '/src', bin: '/opt/k7' }))"

# ---- runtime -------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
# PulseAudio and ALSA's pulse plugin are the audio device; ca-certificates is what the supervisor trusts (docs/supervisor.md).
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
      pulseaudio pulseaudio-utils libasound2 libasound2-plugins \
      libfreetype6 libfontconfig1 libcurl4 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/k7 /opt/k7
# A library the binaries link and this stage lacks fails the build here, not the first start.
RUN ! ldd /opt/k7/k7-runtime /opt/k7/k7-supervisor | grep "not found"
COPY engine/docker/asound.conf /etc/asound.conf
COPY --chmod=755 engine/docker/entrypoint.sh /usr/local/bin/k7-runtime-entrypoint

# PulseAudio refuses to run as root outside system mode, and nothing here needs root.
RUN useradd --system --create-home --home-dir /home/k7 k7 \
 && mkdir -p /engine-home && chown k7:k7 /engine-home
USER k7
ENV HOME=/home/k7 XDG_RUNTIME_DIR=/tmp/runtime-k7
# Nobody hears the null sink, so the engine tells every page driving it to play its broadcast (docs/server-engine.md).
ENV STUDIO_AUDIO_TO_BROWSER=1
# The supervisor's home: identity, settings, the instruments it downloads, the projects' local copies.
ENV STUDIO_HOME=/engine-home
VOLUME ["/engine-home"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/k7-runtime-entrypoint"]
