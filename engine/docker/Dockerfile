# syntax=docker/dockerfile:1
#
# st0-engine — the engine and its supervisor, for the server: the supervisor dials st0's registry over the
# compose network and is listed beside the musicians' machines. There is no sound card, so the engine
# plays into a PulseAudio null sink, which keeps real time; nobody hears it except through the
# broadcast and the renders. docs/server-engine.md.
#
# Build from the repo root: docker build -f engine/docker/Dockerfile .

# ---- build: the two CMake projects and the script that stages them, nothing else of the repo ----
FROM node:22-bookworm AS build
# The same set as the desktop job's Linux leg (.onedev-buildspec.yml), plus ccache.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build ccache git ca-certificates pkg-config python3 \
      libssl-dev \
      libasound2-dev libjack-jackd2-dev libfreetype6-dev libfontconfig1-dev \
      libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev \
      libxrandr-dev libxrender-dev libglu1-mesa-dev mesa-common-dev \
      libcurl4-openssl-dev ladspa-sdk \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY engine/st0-engine engine/st0-engine
COPY engine/st0-supervisor engine/st0-supervisor
COPY packages/supervisor-host/scripts packages/supervisor-host/scripts
# Empty is cores − 2: a JUCE or Tracktion unity file takes a gigabyte to compile (engine/st0-engine/docs/build.md).
ARG BUILD_JOBS=
ENV CMAKE_C_COMPILER_LAUNCHER=ccache CMAKE_CXX_COMPILER_LAUNCHER=ccache CCACHE_DIR=/root/.ccache
# One RUN, because staging reads the Faust libraries out of the build folder, which only a cache mount holds.
RUN --mount=type=cache,target=/src/engine/st0-engine/build,sharing=locked \
    --mount=type=cache,target=/src/engine/st0-supervisor/build,sharing=locked \
    --mount=type=cache,target=/root/.ccache,sharing=locked \
    set -eu; \
    export CMAKE_BUILD_PARALLEL_LEVEL="${BUILD_JOBS:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"; \
    cd /src/engine/st0-engine; \
    [ -f build/release-gcc/CMakeCache.txt ] || cmake --preset release-gcc -DSTUDIO_BUILD_TESTS=OFF; \
    cmake --build --preset release-gcc; \
    cd /src/engine/st0-supervisor; \
    [ -f build/release-gcc/CMakeCache.txt ] || cmake --preset release-gcc; \
    cmake --build --preset release-gcc --target st0-supervisor; \
    node -e "import('/src/packages/supervisor-host/scripts/stageEngine.mjs').then((m) => m.stageEngine({ repo: '/src', bin: '/opt/st0' }))"

# ---- runtime -------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
# PulseAudio and ALSA's pulse plugin are the audio device; ca-certificates is what the supervisor trusts (docs/supervisor.md).
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
      pulseaudio pulseaudio-utils libasound2 libasound2-plugins \
      libfreetype6 libfontconfig1 libcurl4 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/st0 /opt/st0
# A library the binaries link and this stage lacks fails the build here, not the first start.
RUN ! ldd /opt/st0/st0-engine /opt/st0/st0-supervisor | grep "not found"
COPY engine/docker/asound.conf /etc/asound.conf
COPY --chmod=755 engine/docker/entrypoint.sh /usr/local/bin/st0-engine-entrypoint

# PulseAudio refuses to run as root outside system mode, and nothing here needs root.
RUN useradd --system --create-home --home-dir /home/st0 st0 \
 && mkdir -p /engine-home && chown st0:st0 /engine-home
USER st0
ENV HOME=/home/st0 XDG_RUNTIME_DIR=/tmp/runtime-st0
# The supervisor's home: identity, settings, the instruments it downloads, the projects' local copies.
ENV STUDIO_HOME=/engine-home
VOLUME ["/engine-home"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/st0-engine-entrypoint"]
