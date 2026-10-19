cmake_minimum_required(VERSION 3.24)

project(Studio VERSION 0.0.1 LANGUAGES C CXX)
# Surge's macOS sources are Objective-C++, and a language a subdirectory enables leaves the build unwritable (docs/surgePlugin.md).
if(APPLE)
    enable_language(OBJC OBJCXX)
endif()
# The two phones, where the engine is a library inside an app and shares its cuts: no plugin hosting, no Tracktion examples.
if(ANDROID OR IOS)
    set(STUDIO_PHONE ON)
endif()
# Surge XT, built in on every platform, phones included; off only for a build that asks (docs/surgePlugin.md).
option(STUDIO_WITH_SURGE "Build Surge XT into the engine" ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# MSBuild runs cl.exe once per file, so a target compiling JUCE and Tracktion — which the two
# graph test binaries each do, 30 TUs apiece — went through on ONE core of twelve. Ninja needs
# none of this, which is why it is guarded: under Ninja /MP does nothing, and a compiler cache refuses it.
# `/FS` because several cl.exe now write one .pdb, and that is what C1041 asks for. Numbers and the
# rest: AGENTS.md, "Building". Set before FetchContent so it reaches Tracktion's targets, exactly as
# the flags below do.
if(MSVC AND CMAKE_GENERATOR MATCHES "Visual Studio")
    add_compile_options(/MP /FS)
endif()
# The Visual Studio generator defines _MBCS on every target and Ninja does not; Faust's Windows code branches on it.
if(MSVC AND NOT CMAKE_GENERATOR MATCHES "Visual Studio")
    add_compile_definitions(_MBCS)
endif()

# -----------------------------------------------------------------------------
# Shared dependencies (fetched once here, consumed by the packages below)
#
# The apps that drive the engine are Node apps (apps/k7), so there's no C++ UI or YAML
# dependency here — just the audio engine and the WebSocket transport.
# Tracktion is HEAVY (bundles JUCE, hundreds of MB, long first build).
# -----------------------------------------------------------------------------
include(FetchContent)

# Every download SAID, with its progress: a first configure fetches hundreds of MB, and a silent one
# reads as a hang in a CI log. GIT_PROGRESS on each git source below is the other half.
set(FETCHCONTENT_QUIET OFF)

# $STUDIO_FETCHCONTENT_DIR, which CI sets and keeps between runs, holds every download instead of the
# build tree, so a fresh build clones nothing; this project gets its own folder in it. A folder of
# SOURCES only: the job deletes what gets built in it, which differs per preset and per target.
if(NOT "$ENV{STUDIO_FETCHCONTENT_DIR}" STREQUAL "")
    set(FETCHCONTENT_BASE_DIR "$ENV{STUDIO_FETCHCONTENT_DIR}/k7-runtime" CACHE PATH "" FORCE)
    set(FETCHCONTENT_UPDATES_DISCONNECTED ON)
endif()

# A patch command carries its script's checksum, so a kept source tree re-runs a patch edited since (docs/build.md).
function(studio_patch_command out script)
    file(SHA256 "${script}" sum)
    file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/engine/eurorack/patches/studio_replace.cmake" shared)
    set(${out} ${CMAKE_COMMAND} -DSTUDIO_PATCH_SUM=${sum}-${shared} -P "${script}" PARENT_SCOPE)
    # …and an edited script re-runs the configure, without which a kept build folder never sees the new checksum.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${script}"
        "${CMAKE_CURRENT_SOURCE_DIR}/engine/eurorack/patches/studio_replace.cmake")
endfunction()
foreach(_patch faust sfizz surge ixwebsocket tracktion)
    studio_patch_command(STUDIO_PATCH_${_patch} "${CMAKE_CURRENT_SOURCE_DIR}/engine/patches/${_patch}.cmake")
endforeach()
foreach(_patch eurorack stmlib)
    studio_patch_command(STUDIO_PATCH_${_patch} "${CMAKE_CURRENT_SOURCE_DIR}/engine/eurorack/patches/${_patch}.cmake")
endforeach()

# --- nlohmann/json : parse the JSON project the frontend sends (server) --------
# Upstream's release archive for FetchContent: the headers and the CMake files, 0.1 MB against a clone's 186.
FetchContent_Declare(nlohmann_json
    URL      https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d)
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
    GIT_PROGRESS   ON
    # v0.5.4, the newest tag: v0.4.0 accepted .nam files up to format 0.6.0, and models
    # exported by current NAM trainers are 0.7.0 — get_dsp threw on them, NamPlugin kept a
    # null DSP, and the plugin passed audio through untouched. A refused model sounded
    # exactly like a working one.
    #
    # NB upstream's own NAM/version.h reads 0.5.3 at this tag; the tag is the truth here.
    GIT_TAG        v0.5.4
    GIT_SHALLOW    ON
    # None of its submodules: we compile NAM/ only, against the eigen declared below. Recursing
    # cloned Eigen twice more (its own, and AudioDSPTools') — ~300 MB of full history for nothing.
    GIT_SUBMODULES ""
    SOURCE_SUBDIR  studio-does-not-build-this)

# NAM's linear algebra. Header-only, so nothing is built.
#
# Pinned to the exact commit NAM vendors as its own submodule (a post-3.4 master
# snapshot), NOT to the 3.4.0 release: NAM's lstm.h uses Eigen::placeholders::lastN,
# which 3.4.0 spells Eigen::lastN — the tag fails to compile against this NAM. GitLab's
# archive of that commit rather than a clone, which could not be shallow at a commit.
FetchContent_Declare(eigen
    URL      https://gitlab.com/libeigen/eigen/-/archive/87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1/eigen-87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1.tar.gz
    URL_HASH SHA256=50e5eaae4c213e51dee1727c42d1ada5f8c4f025c0e81d1d517b30f6142fb30d
    SOURCE_SUBDIR  studio-does-not-build-this)

# --- RTNeural : the recurrent amp models NAM does not read (AIDA-X, Proteus) -----
# BSD-3, header templates over the Eigen above. Populated, never built: its CMake builds a static
# library of explicit instantiations we do not need, and would pin its own Eigen and json.
# No tags upstream, so a commit. Rationale: docs/namPlugin.md.
FetchContent_Declare(rtneural
    GIT_REPOSITORY https://github.com/jatinchowdhury18/RTNeural.git
    GIT_PROGRESS   ON
    GIT_TAG        95c3c0f987a6fe903e7eec71e797405dbed7caf7
    GIT_SUBMODULES ""
    SOURCE_SUBDIR  studio-does-not-build-this)

# --- Faust : compile a module's `dsp.dsp` at runtime (engine) ------------------
#
# The INTERPRETER backend, not LLVM. It is already in libfaust's static library by default
# (build/backends/interp.cmake), it needs no LLVM at all, and it costs ~4 MB in the linked
# binary where LLVM would cost tens. Measured, with the three traps that came with it:
# engine/k7-runtime/docs/faust.md.
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
# for architectures we do not build. Two archives: the tag's, and faustlibraries' at the commit it pins.
FetchContent_Declare(faust
    DOWNLOAD_COMMAND ${CMAKE_COMMAND} -DSRC=<SOURCE_DIR>
        -DURL0=https://codeload.github.com/grame-cncm/faust/tar.gz/refs/tags/2.85.9
        -DSHA0=a615582af7729b93428a8fd987f9b34261a748f4270ff9608ea9b7b3c5d474da
        -DURL1=https://codeload.github.com/grame-cncm/faustlibraries/tar.gz/78a72d4998dec43e20492ef9b78d1a785b3dc864
        -DSHA1=6331b79fff8f767039bb3097aa4bd3df9421c792eab0524a7a47347c0dfc44cb
        -DDIR1=libraries
        -P "${CMAKE_CURRENT_SOURCE_DIR}/engine/patches/archive-fetch.cmake"
    UPDATE_COMMAND ""
    # poly-dsp.h prints on the audio thread at every voice steal; explained in the script.
    PATCH_COMMAND ${STUDIO_PATCH_faust}
    SOURCE_SUBDIR  build)

# --- sfizz : plays SFZ instruments, for SfzPlugin ------------------------------
# BSD-2, a C++ sampler library: an instrument is a `.sfz` text and the samples it names, so a
# multi-sampled piano is a folder of files rather than a plugin to install. Built STATIC, with its
# own stand-alone tools off. Upstream is archived; the two fixes today's compilers need are in the
# patch script. Rationale: docs/sfzPlugin.md.
# Upstream's source archive carries all six submodules the library compiles (abseil, the audio file readers…), minus their tests.
FetchContent_Declare(sfizz
    URL      https://github.com/sfztools/sfizz/releases/download/1.2.3/sfizz-1.2.3.tar.gz
    URL_HASH SHA256=a9339eac7620d7f0f6b44bdfe860680fab73e66efad4b5f15b21198dd9436822
    PATCH_COMMAND ${STUDIO_PATCH_sfizz})
set(SFIZZ_SHARED OFF CACHE BOOL "" FORCE)
set(SFIZZ_JACK OFF CACHE BOOL "" FORCE)
set(SFIZZ_RENDER OFF CACHE BOOL "" FORCE)
set(SFIZZ_TESTS OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEMOS OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEVTOOLS OFF CACHE BOOL "" FORCE)
set(SFIZZ_BENCHMARKS OFF CACHE BOOL "" FORCE)
# sfizz's own option, despite the generic name; LTO across a static library is the parent's call.
set(ENABLE_LTO OFF CACHE BOOL "" FORCE)

# --- Surge XT : a full synthesizer, for SurgePlugin -------------------------------
# GPLv3 like this engine. Only its core is built — no JUCE, no plugin wrappers, no Lua, no MTS —
# and only the submodules that core compiles. A commit of main rather than the 1.3.4 release:
# that release's core still links juce_dsp, which would put a second JUCE beside Tracktion's.
# Fetched by a script because FetchContent cannot shallow-fetch a commit; the four fixes being a
# subproject needs are in the patch script. Rationale: docs/surgePlugin.md.
if(STUDIO_WITH_SURGE)
    set(STUDIO_SURGE_COMMIT baa97f7cad09d3dcde472137ed030829ff55d202)
    set(STUDIO_SURGE_SUBMODULES "libs/PEGTL,libs/eurorack/eurorack,libs/fmt,libs/pffft,libs/simde,libs/zstd,libs/r8brain-free-src,libs/tuning-library,libs/sst/sst-basic-blocks,libs/sst/sst-cmake,libs/sst/sst-cpputils,libs/sst/sst-effects,libs/sst/sst-filters,libs/sst/sst-plugininfra,libs/sst/sst-waveshapers")
    FetchContent_Declare(surge
        DOWNLOAD_COMMAND ${CMAKE_COMMAND} -DSRC=<SOURCE_DIR> -DCOMMIT=${STUDIO_SURGE_COMMIT}
                         -DSUBMODULES=${STUDIO_SURGE_SUBMODULES}
                         -P "${CMAKE_CURRENT_SOURCE_DIR}/engine/patches/surge-fetch.cmake"
        UPDATE_COMMAND   ""
        PATCH_COMMAND    ${STUDIO_PATCH_surge})
    set(SURGE_SKIP_JUCE_FOR_RACK ON CACHE BOOL "" FORCE)
    set(SURGE_SKIP_LUA ON CACHE BOOL "" FORCE)
    set(SURGE_SKIP_ODDSOUND_MTS ON CACHE BOOL "" FORCE)
    set(SURGE_SKIP_STANDALONE ON CACHE BOOL "" FORCE)
    set(SURGE_SKIP_VST3 ON CACHE BOOL "" FORCE)
    set(SURGE_SKIP_WERROR ON CACHE BOOL "" FORCE)
    set(SURGE_BUILD_XT OFF CACHE BOOL "" FORCE)
    set(SURGE_BUILD_FX OFF CACHE BOOL "" FORCE)
    set(SURGE_BUILD_CLAP OFF CACHE BOOL "" FORCE)
    set(SURGE_BUILD_TESTRUNNER OFF CACHE BOOL "" FORCE)
    set(SURGE_COPY_TO_PRODUCTS OFF CACHE BOOL "" FORCE)
    # The other branch stamps the build TIME into a source, which would relink the engine on every build.
    set(SURGE_RELIABLE_VERSION_INFO OFF CACHE BOOL "" FORCE)
    # std::filesystem, as the engine uses it; its probe would otherwise run under Tracktion's forced 10.13 and fail.
    set(SST_PLUGININFRA_FILESYSTEM_FORCE_PLATFORM ON CACHE BOOL "" FORCE)
endif()

# --- QuickJS (quickjs-ng) : evaluates Strudel patterns, for PatternPlugin --------
# A small C interpreter, statically linked; the pattern language itself is a committed bundle
# (engine/strudel/strudel.bundle.js). Why an interpreter in the engine at all: docs/patternPlugin.md.
FetchContent_Declare(quickjs
    GIT_REPOSITORY https://github.com/quickjs-ng/quickjs.git
    GIT_PROGRESS   ON
    GIT_TAG        v0.17.0
    GIT_SHALLOW    ON)

# --- Mutable Instruments' eurorack firmware : the DSP of eight modules (engine) --
# The STM32 modules' code is MIT; only their DSP folders are compiled, never the drivers or UI, and
# built with TEST defined, which is how the firmware's own desktop harnesses build it. Archives
# pinned by hash rather than git: a shallow clone cannot fetch a commit, and the full history is
# hundreds of MB of hardware files. stmlib is the firmware's submodule, at the commit it pins, and
# sits in a folder NAMED stmlib because every module includes it as "stmlib/...".
# Why these modules and not the rest: docs/eurorack.md.
FetchContent_Declare(eurorack
    URL      https://github.com/pichenettes/eurorack/archive/08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4.tar.gz
    URL_HASH SHA256=9f83180320097b6f461e996845fd34153238c4956ccb5a64e27c5048e0d4c180
    # Upstream bugs this port fixes, each named and explained in the script.
    PATCH_COMMAND ${STUDIO_PATCH_eurorack}
    SOURCE_SUBDIR studio-does-not-build-this)
FetchContent_Declare(stmlib
    URL      https://github.com/pichenettes/stmlib/archive/e3bd7c9cc00e4364166f9905c0509b6ffd0535ec.tar.gz
    URL_HASH SHA256=eff5d6642a93498996661e0dd4b5a1de4b98093f25a009166910726d1262b5d2
    SOURCE_DIR "${FETCHCONTENT_BASE_DIR}/stmlib-root/stmlib"
    # What MSVC cannot compile as shipped, explained in the script.
    PATCH_COMMAND ${STUDIO_PATCH_stmlib}
    SOURCE_SUBDIR studio-does-not-build-this)

# --- IXWebSocket : the WebSocket server transport (server) --------------------
FetchContent_Declare(ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_PROGRESS   ON
    GIT_TAG        v12.0.1
    GIT_SHALLOW    ON
    # A client message is buffered whole before anything reads it, and IXWebSocket caps none; explained in the script.
    PATCH_COMMAND ${STUDIO_PATCH_ixwebsocket})
set(USE_TLS OFF CACHE BOOL "" FORCE)          # localhost IPC — no TLS needed
set(USE_ZLIB OFF CACHE BOOL "" FORCE)         # no permessage-deflate; avoids a zlib dep (Windows has no system zlib)

# --- Tracktion Engine : the audio engine (+ JUCE via submodules) (engine) -----
# Pinned to v3.2.0 (latest release, JUCE 8). engine/EngineHost.cpp targets this
# exact tag; bump deliberately and re-test it. JUCE, its one submodule, is fetched as an
# archive of the commit v3.2.0 pins: a bump moves both lines together.

# On a phone, populate only: Tracktion's root always adds its examples, and EngineInPluginDemo
# depends on a VST3 target that does not exist there — configure fails on a demo we never build.
# The two directories the engine needs are added by hand after MakeAvailable, below.
if(STUDIO_PHONE)
    set(STUDIO_TRACKTION_SUBDIR SOURCE_SUBDIR studio-does-not-build-this)
endif()

FetchContent_Declare(tracktion_engine
    DOWNLOAD_COMMAND ${CMAKE_COMMAND} -DSRC=<SOURCE_DIR>
        -DURL0=https://codeload.github.com/Tracktion/tracktion_engine/tar.gz/refs/tags/v3.2.0
        -DSHA0=4314dc05db9abeb39436abca759098004847d77400339648c54f49451c7bb806
        -DURL1=https://codeload.github.com/juce-framework/JUCE/tar.gz/19edd538429c93d277bf95b55aaa7e3eb545f951
        -DSHA1=5be3406ca3c7e4e757b1ca4d8e9083024563ce05a3a675597adadbcc8f334e82
        -DDIR1=modules/juce
        -P "${CMAKE_CURRENT_SOURCE_DIR}/engine/patches/archive-fetch.cmake"
    UPDATE_COMMAND ""
    # SamplerPlugin re-decodes every rack sound on any change to one, and the file-check callback reads an empty queue; explained in the script.
    PATCH_COMMAND ${STUDIO_PATCH_tracktion}
    ${STUDIO_TRACKTION_SUBDIR})

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
# the add_subdirectory inside FetchContent_MakeAvailable. Not on a phone: there is no
# plugin to host there, and no window to give its editor.
if(NOT STUDIO_PHONE)
    add_compile_definitions(JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_LADSPA=1)
endif()

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

FetchContent_MakeAvailable(nlohmann_json ixwebsocket tracktion_engine nam_core eigen rtneural faust quickjs
                           eurorack stmlib)
# sfizz is C++14/17 code (its own pick on MSVC is 17), and ours is 20, under which std::result_of is gone and abseil
# changes types: built at 17 everywhere, its public header — the only one we include — being plain std.
set(CMAKE_CXX_STANDARD 17)
FetchContent_MakeAvailable(sfizz)
set(CMAKE_CXX_STANDARD 20)
if(STUDIO_WITH_SURGE)
    # Surge's sources are compiled at the engine's macOS floor, not the 10.13 Tracktion forced (see below); iOS keeps its preset's.
    if(APPLE AND NOT IOS)
        set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
    endif()
    # Surge carries its own copies of code the engine already links — Mutable Instruments' plaits, clouds and stmlib
    # at another commit, a newer tuning-library than sfizz's — so its namespaces are renamed: a static link would
    # otherwise keep ONE of each, silently, and run the other's code on the wrong layout (docs/surgePlugin.md).
    set(STUDIO_SURGE_RENAMES plaits=surge_plaits clouds=surge_clouds stmlib=surge_stmlib Tunings=surge_Tunings)
    get_directory_property(_studio_defs COMPILE_DEFINITIONS)
    add_compile_definitions(${STUDIO_SURGE_RENAMES})
    FetchContent_MakeAvailable(surge)
    set_directory_properties(PROPERTIES COMPILE_DEFINITIONS "${_studio_defs}")
endif()

# A phone populated Tracktion without building its root (see its declaration): add JUCE and the
# Tracktion modules the way that root does, minus the examples.
if(STUDIO_PHONE)
    add_subdirectory(${tracktion_engine_SOURCE_DIR}/modules/juce ${tracktion_engine_BINARY_DIR}/juce)
    add_subdirectory(${tracktion_engine_SOURCE_DIR}/modules ${tracktion_engine_BINARY_DIR}/modules)
endif()

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
set(STUDIO_RTNEURAL_DIR "${rtneural_SOURCE_DIR}" CACHE INTERNAL "RTNeural source")
# NAM includes its JSON as <json.hpp>, not <nlohmann/json.hpp>, so it needs the directory
# the header sits IN — the nlohmann_json target's own interface points one level up.
set(STUDIO_JSON_DIR "${nlohmann_json_SOURCE_DIR}/include/nlohmann" CACHE INTERNAL "nlohmann/json.hpp's own directory")

# The eurorack sources, and the folder ABOVE stmlib: the two include roots engine/eurorack/ compiles with.
set(STUDIO_EURORACK_DIR "${eurorack_SOURCE_DIR}" CACHE INTERNAL "Mutable Instruments eurorack source")
get_filename_component(_stmlib_parent "${stmlib_SOURCE_DIR}" DIRECTORY)
set(STUDIO_STMLIB_ROOT "${_stmlib_parent}" CACHE INTERNAL "The folder holding stmlib/")

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
# needs. Lower it to 10.15 if an Intel/Catalina build ever matters. Not iOS, whose
# preset's floor stands: no example is added there to force anything over it.
if(APPLE AND NOT IOS)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
endif()

# -----------------------------------------------------------------------------
# The C++ packages (monorepo-style)
#
#   engine/  -> studio::engine  (library: model, diff, Tracktion host)
#   server/  -> k7-runtime  (app: WebSocket audio server)
#
# The apps that drive the engine are Node apps elsewhere in the repo and are NOT built here.
#
# Note: Tracktion also declares example/test targets nothing here depends on, so
# building the `k7-runtime` target never touches them. The build presets
# pin "targets": ["k7-runtime"] to keep it that way.
# -----------------------------------------------------------------------------
add_subdirectory(engine)
add_subdirectory(server)

# --- Unit tests (JUCE-free data layer) ----------------------------------------
# ON by default for local dev; the build presets pin "targets": ["k7-runtime"],
# so the test target isn't built by a normal preset build — build + run it with
# `npm run test --workspace k7-runtime`, which takes the build folder's lock (or `ctest`). Off with -DSTUDIO_BUILD_TESTS=OFF.
option(STUDIO_BUILD_TESTS "Build the engine unit tests" ON)
if(STUDIO_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
