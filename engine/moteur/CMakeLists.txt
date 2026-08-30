cmake_minimum_required(VERSION 3.24)

project(Studio VERSION 0.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# MSBuild runs cl.exe once per file, so a target compiling JUCE and Tracktion — which the two
# graph test binaries each do, 30 TUs apiece — went through on ONE core of twelve. Ninja needs
# none of this, which is why it is guarded. `/FS` because several cl.exe now write one .pdb,
# and that is what C1041 asks for. Numbers and the rest: AGENTS.md, "Building".
# Set before FetchContent so it reaches Tracktion's targets, exactly as the flags below do.
if(MSVC)
    add_compile_options(/MP /FS)
endif()

# -----------------------------------------------------------------------------
# Shared dependencies (fetched once here, consumed by the packages below)
#
# The frontend is a separate Node app (../brain), so there's no C++ UI or YAML
# dependency here — just the audio engine and the WebSocket transport.
# Tracktion is HEAVY (bundles JUCE, hundreds of MB, long first build).
# -----------------------------------------------------------------------------
include(FetchContent)

# --- nlohmann/json : parse the JSON project the frontend sends (server) --------
FetchContent_Declare(nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    ON)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)

# --- Neural Amp Modeler : the amp/pedal modeller's DSP core -------------------
# MIT, header-light C++ that loads a .nam model (JSON weights) and runs its WaveNet /
# LSTM inference. Only the CORE — the official plugin is iPlug2 and we have no use for
# its UI. It brings the non-linear half of a guitar rig, which convolution cannot do at
# all: an impulse response is linear by construction, so it gives you the cabinet and
# never the amp.
#
# NAM_SAMPLE defaults to double; NAM_SAMPLE_FLOAT makes it float, which is what JUCE
# hands us — otherwise every block pays a convert-out/convert-back around process().
#
# Fetched but NOT added as a subproject: NAM ships CMake targets that build its test
# tools and pin an Eigen of their own, and Eigen's CMake installs a whole package. We
# want neither — just the sources compiled into studio_engine with OUR flags, which is
# what makes NAM_SAMPLE_FLOAT stick. Pointing SOURCE_SUBDIR at a directory that holds no
# CMakeLists is the supported way to say "populate, don't build" (the one-argument
# FetchContent_Populate that used to mean this is deprecated).
FetchContent_Declare(nam_core
    GIT_REPOSITORY https://github.com/sdatkinson/NeuralAmpModelerCore.git
    # v0.5.4, the newest tag: v0.4.0 accepted .nam files up to format 0.6.0, and models
    # exported by current NAM trainers are 0.7.0 — get_dsp threw on them, NamPlugin kept a
    # null DSP, and the plugin passed audio through untouched. A refused model sounded
    # exactly like a working one.
    #
    # NB upstream's own NAM/version.h reads 0.5.3 at this tag; the tag is the truth here.
    GIT_TAG        v0.5.4
    GIT_SHALLOW    ON
    SOURCE_SUBDIR  studio-does-not-build-this)

# NAM's linear algebra. Header-only, so nothing is built.
#
# Pinned to the exact commit NAM vendors as its own submodule (a post-3.4 master
# snapshot), NOT to the 3.4.0 release: NAM's lstm.h uses Eigen::placeholders::lastN,
# which 3.4.0 spells Eigen::lastN — the tag fails to compile against this NAM. No
# GIT_SHALLOW, because a shallow clone can only fetch a ref, not an arbitrary commit.
FetchContent_Declare(eigen
    GIT_REPOSITORY https://gitlab.com/libeigen/eigen.git
    GIT_TAG        87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1
    SOURCE_SUBDIR  studio-does-not-build-this)

# --- Faust : compile a module's `dsp.dsp` at runtime (engine) ------------------
#
# The INTERPRETER backend, not LLVM. It is already in libfaust's static library by default
# (build/backends/interp.cmake), it needs no LLVM at all, and it costs ~4 MB in the linked
# binary where LLVM would cost tens. Measured, with the three traps that came with it:
# engine/moteur/docs/faust.md.
#
# The backend selection is normally made by preloading that file with cmake's `-C`, which
# FetchContent cannot do — so the same variables are FORCEd here instead. They have to be set
# BEFORE MakeAvailable, like every other flag that has to reach a fetched target.
set(C_BACKEND      OFF              CACHE STRING "" FORCE)
set(CPP_BACKEND    "STATIC DYNAMIC" CACHE STRING "" FORCE)
set(CMAJOR_BACKEND OFF              CACHE STRING "" FORCE)
set(CSHARP_BACKEND OFF              CACHE STRING "" FORCE)
set(DLANG_BACKEND  OFF              CACHE STRING "" FORCE)
set(FIR_BACKEND    OFF              CACHE STRING "" FORCE)
set(INTERP_BACKEND OFF              CACHE STRING "" FORCE)
set(INTERP_COMP_BACKEND "STATIC DYNAMIC" CACHE STRING "" FORCE)
set(JAVA_BACKEND   OFF              CACHE STRING "" FORCE)
set(JAX_BACKEND    OFF              CACHE STRING "" FORCE)
set(JULIA_BACKEND  OFF              CACHE STRING "" FORCE)
set(JSFX_BACKEND   OFF              CACHE STRING "" FORCE)
set(LLVM_BACKEND   OFF              CACHE STRING "" FORCE)
set(OLDCPP_BACKEND OFF              CACHE STRING "" FORCE)
set(RUST_BACKEND   OFF              CACHE STRING "" FORCE)
set(TEMPLATE_BACKEND OFF            CACHE STRING "" FORCE)
set(WASM_BACKEND   OFF              CACHE STRING "" FORCE)
# The static library and nothing else: no `faust` command-line compiler, no OSC or HTTP
# servers (the latter wants libmicrohttpd), no emscripten targets.
set(INCLUDE_STATIC     ON  CACHE BOOL "" FORCE)
set(INCLUDE_DYNAMIC    OFF CACHE BOOL "" FORCE)
set(INCLUDE_EXECUTABLE OFF CACHE BOOL "" FORCE)
set(INCLUDE_OSC        OFF CACHE BOOL "" FORCE)
set(INCLUDE_HTTP       OFF CACHE BOOL "" FORCE)
set(INCLUDE_EMCC       OFF CACHE BOOL "" FORCE)
set(INCLUDE_WASM_GLUE  OFF CACHE BOOL "" FORCE)

# `libraries/` is a SUBMODULE (grame-cncm/faustlibraries) and it is not optional: it is where
# `import("stdfaust.lib")` resolves. Without it the build succeeds and every module fails to
# compile at RUNTIME, which is the worst place to find out. Named explicitly rather than
# recursing, because the other eight submodules are oboe, clap and friends — hundreds of MB
# for architectures we do not build.
FetchContent_Declare(faust
    GIT_REPOSITORY https://github.com/grame-cncm/faust.git
    GIT_TAG        2.85.9
    GIT_SUBMODULES "libraries"
    GIT_SHALLOW    ON
    SOURCE_SUBDIR  build)

# --- IXWebSocket : the WebSocket server transport (server) --------------------
FetchContent_Declare(ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG        v12.0.1
    GIT_SHALLOW    ON)
set(USE_TLS OFF CACHE BOOL "" FORCE)          # localhost IPC — no TLS needed
set(USE_ZLIB OFF CACHE BOOL "" FORCE)         # no permessage-deflate; avoids a zlib dep (Windows has no system zlib)

# --- Tracktion Engine : the audio engine (+ JUCE via submodules) (engine) -----
# Pinned to v3.2.0 (latest release, JUCE 8). engine/EngineHost.cpp targets this
# exact tag; bump deliberately and re-test it.
# Tracktion's .gitmodules pins JUCE over SSH (git@github.com:juce-framework/JUCE.git),
# so populating it needs a GitHub SSH key AND an already-trusted host key. On a fresh
# machine or a CI runner (which rarely has either) configure dies with "Host key
# verification failed" nowhere near anything we wrote. JUCE is public, so rewrite that
# one URL to HTTPS.
#
# This has to be an env var, NOT FetchContent's GIT_CONFIG. GIT_CONFIG only writes the
# rewrite into the superproject's .git/config, but `git submodule update` clones each
# submodule in a CHILD git process that has no repo context yet, so it reads only the
# system/global scopes and never sees it — the clone still goes out over SSH. Git
# passes GIT_CONFIG_* down to those children, which is exactly what we need.
# Deliberately scoped to this configure run: no global git config, no ~/.ssh changes.
set(ENV{GIT_CONFIG_COUNT} 1)
set(ENV{GIT_CONFIG_KEY_0} "url.https://github.com/.insteadOf")
set(ENV{GIT_CONFIG_VALUE_0} "git@github.com:")

FetchContent_Declare(tracktion_engine
    GIT_REPOSITORY https://github.com/Tracktion/tracktion_engine.git
    GIT_TAG        v3.2.0
    GIT_SUBMODULES_RECURSE ON
    GIT_SHALLOW    OFF)               # submodules need full history to resolve

# --- Steinberg ASIO SDK : low-latency Windows audio (engine) ------------------
# REQUIRED on Windows: ASIO is how a real interface is driven there (the other
# backends are the fallbacks), so the build refuses to produce an engine that
# can't see those devices.
#
# Steinberg's licence forbids redistributing the SDK, so it isn't vendored here — we
# fetch it from Steinberg, like every other dependency. The SDK is Steinberg's and
# subject to their licence agreement (included in the archive). To build offline, or
# to use a copy you've already accepted the licence for:
#   cmake --preset windows-msvc -DSTUDIO_ASIO_SDK_DIR=C:/path/to/asiosdk
#
# Pinned like the other deps: https://www.steinberg.net/asiosdk always redirects to
# the newest SDK, which would silently change the build under us.
# ASIO is Windows-only — on Linux/macOS JUCE uses ALSA/JACK/CoreAudio and none of
# this applies.
set(STUDIO_ASIO_SDK_DIR "$ENV{ASIOSDK_DIR}" CACHE PATH
    "Path to an unpacked Steinberg ASIO SDK (default: fetched from Steinberg)")

if(WIN32)
    if(NOT STUDIO_ASIO_SDK_DIR)
        # SOURCE_SUBDIR names a directory with no CMakeLists.txt, so MakeAvailable
        # only downloads + extracts and never tries to add_subdirectory the SDK.
        FetchContent_Declare(asiosdk
            URL      https://download.steinberg.net/sdk_downloads/ASIO-SDK_2.3.4_2025-10-15.zip
            URL_HASH SHA256=d5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca
            SOURCE_SUBDIR  no-cmake-here)
        FetchContent_MakeAvailable(asiosdk)
        set(STUDIO_ASIO_SDK_DIR "${asiosdk_SOURCE_DIR}")
    endif()

    # Find iasiodrv.h wherever the archive put it rather than assuming a layout:
    # the SDK has been repackaged across versions, and a local copy may be unpacked
    # one level deeper.
    file(GLOB_RECURSE _asio_headers "${STUDIO_ASIO_SDK_DIR}/iasiodrv.h"
                                    "${STUDIO_ASIO_SDK_DIR}/*/iasiodrv.h")
    if(NOT _asio_headers)
        message(FATAL_ERROR
            "studio: the Steinberg ASIO SDK is required on Windows but iasiodrv.h was not found under\n"
            "  ${STUDIO_ASIO_SDK_DIR}\n"
            "Either let the build fetch it (unset STUDIO_ASIO_SDK_DIR and allow network access),\n"
            "or download it from https://www.steinberg.net/asiosdk and point at the unpacked folder:\n"
            "  cmake --preset windows-msvc -DSTUDIO_ASIO_SDK_DIR=C:/path/to/asiosdk")
    endif()
    list(GET _asio_headers 0 _asio_header)
    get_filename_component(STUDIO_ASIO_INCLUDE_DIR "${_asio_header}" DIRECTORY)
    message(STATUS "studio: ASIO enabled (${STUDIO_ASIO_INCLUDE_DIR})")
endif()

# --- Plugin hosting formats + ASIO --------------------------------------------
# Enable VST3 (and LADSPA) hosting in the JUCE modules Tracktion compiles. These
# must be set BEFORE tracktion_engine is made available so juce_audio_processors
# picks them up. Global scope so they reach the Tracktion/JUCE targets created by
# the add_subdirectory inside FetchContent_MakeAvailable.
add_compile_definitions(JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_LADSPA=1)

# Enable a time-stretch backend so imported clip warp/stretch actually stretches
# (see EditBuilder::applyClipWarp). Without any TRACKTION_ENABLE_TIMESTRETCH_* flag,
# TimeStretcher::checkModeIsAvailable() reports every mode as `disabled` and warp is a
# no-op. SoundTouch ships with Tracktion (3rd_party/soundtouch) and is license-free, so
# it's the safe default; Elastique/RubberBand need their own libraries. Must be set
# before FetchContent_MakeAvailable so the tracktion_engine module compiles it in.
add_compile_definitions(TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH=1)

# Compile in the AirWindows effects Tracktion vendors: 186 built-ins (drives, tape,
# chorus, delays, reverbs) that cost nothing to ship and, unlike a commercial pedal
# suite, register every control through addAutomatableParameter — so each is fully
# addressable from a module's .cue with no native UI. Both the classes AND
# PluginManager::initialiseAirWindows() sit behind this flag, so without it that
# function does not exist to call. Same rule as the flag above: it has to reach the
# tracktion_engine target, hence before FetchContent_MakeAvailable.
add_compile_definitions(TRACKTION_AIR_WINDOWS=1)
# The vendored AirWindows DSP (3rd_party/airwindows) uses M_PI, which MSVC's <cmath>
# only declares when this is defined — it is not standard C++. Harmless elsewhere, and
# it has to be global for the same reason as the flag above: the code lives in the
# tracktion_engine target, not ours.
add_compile_definitions(_USE_MATH_DEFINES)

# JUCE_ASIO decides whether juce_audio_devices compiles the ASIO backend AT ALL, so
# — like the flags above — it has to reach that target, not just our own TU. Same
# for the SDK's headers, which juce_ASIO_windows.cpp includes.
if(WIN32)
    include_directories("${STUDIO_ASIO_INCLUDE_DIR}")
    add_compile_definitions(JUCE_ASIO=1)
endif()

FetchContent_MakeAvailable(nlohmann_json ixwebsocket tracktion_engine nam_core eigen faust)

# Where engine/CMakeLists.txt finds the headers and the standard libraries. The LIBRARY itself
# is linked as the `staticlib` TARGET rather than by path — see the note there.
#
# The second is a RUNTIME path, not a build one: `import("stdfaust.lib")` is resolved when a
# module is compiled, which happens while the engine runs. See FaustPlugin::faustLibrariesDir.
set(STUDIO_FAUST_SRC "${faust_SOURCE_DIR}" CACHE INTERNAL "Faust source")
set(STUDIO_FAUST_LIBS "${faust_SOURCE_DIR}/libraries" CACHE INTERNAL "Faust standard libraries")

# Where engine/CMakeLists.txt picks the NAM sources and Eigen's headers up from.
set(STUDIO_NAM_DIR "${nam_core_SOURCE_DIR}" CACHE INTERNAL "NeuralAmpModelerCore source")
set(STUDIO_EIGEN_DIR "${eigen_SOURCE_DIR}" CACHE INTERNAL "Eigen source")
# NAM includes its JSON as <json.hpp>, not <nlohmann/json.hpp>, so it needs the directory
# the header sits IN — the nlohmann_json target's own interface points one level up.
set(STUDIO_JSON_DIR "${nlohmann_json_SOURCE_DIR}/include/nlohmann" CACHE INTERNAL "nlohmann/json.hpp's own directory")

# --- macOS deployment target: re-assert AFTER Tracktion (order matters) --------
# Every tracktion examples/*/CMakeLists.txt does, inside if(APPLE):
#     set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE INTERNAL "")
# INTERNAL implies FORCE, so the line above — via add_subdirectory(examples) in
# Tracktion's root — stamps 10.13 over whatever the macos-clang preset asked for.
# That's fatal for us, not cosmetic: std::filesystem is marked unavailable before
# macOS 10.15, so EngineHost.cpp's fs:: calls die with "'path' is unavailable".
#
# Setting it in the preset does NOT survive (verified: the cache and all 284 compile
# lines came back 10.13). A NORMAL variable does — it shadows the forced cache entry
# for this scope and everything below, so engine/ and server/ both compile at 11.0
# while Tracktion's own example targets (which we never build) keep their 10.13.
# 11.0 is the arm64 floor anyway, and comfortably clears the 10.15 std::filesystem
# needs. Lower it to 10.15 if an Intel/Catalina build ever matters.
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
endif()

# -----------------------------------------------------------------------------
# The C++ packages (monorepo-style)
#
#   engine/  -> studio::engine  (library: model, diff, Tracktion host)
#   server/  -> st0-engine  (app: WebSocket audio server)
#
# The frontend lives in ../brain as a standalone Node app and is NOT built here.
#
# Note: Tracktion also declares example/test targets nothing here depends on, so
# building the `st0-engine` target never touches them. The build presets
# pin "targets": ["st0-engine"] to keep it that way.
# -----------------------------------------------------------------------------
add_subdirectory(engine)
add_subdirectory(server)

# --- Unit tests (JUCE-free data layer) ----------------------------------------
# ON by default for local dev; the build presets pin "targets": ["st0-engine"],
# so the test target isn't built by a normal preset build — build + run it with
# `npm run test:mac --workspace moteur` (or `ctest`). Off with -DSTUDIO_BUILD_TESTS=OFF.
option(STUDIO_BUILD_TESTS "Build the engine unit tests" ON)
if(STUDIO_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
