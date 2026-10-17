# studio::engine — the audio backend package.
#
# Turns a ProjectDoc into a live Tracktion Edit and plays it. It does NOT parse
# any file format — the Node frontend (brain/) owns YAML and sends a ProjectDoc
# as JSON over the WebSocket. Tracktion is linked PRIVATE: no public header of
# this library includes it (EngineHost.h only forward-declares Tracktion types),
# so consumers — the WebSocket server — compile against this API without ever
# seeing JUCE. It still gets linked into the final executable, because a static
# library's private link deps propagate to whoever links the library.

add_library(studio_engine STATIC
    ProjectDoc.cpp
    ProjectDiff.cpp
    EngineHost.cpp
    AudioDevices.cpp
    PluginParams.cpp
    Warnings.cpp
    PluginScan.cpp
    EditBuilder.cpp
    OfflineRender.cpp
    MultiEditTest.cpp
    Decode.cpp
    LoadGuard.cpp
    PathRoots.cpp
    WaveformTapPlugin.cpp
    BroadcastTapPlugin.cpp
    RecorderPlugin.cpp
    NamPlugin.cpp
    NamModel.cpp
    RtNeuralModel.cpp
    DspGraph.cpp
    GraphDspPlugin.cpp
    FaustPlugin.cpp
    PatternPlugin.cpp
    MasterGainPlugin.cpp
    MixerPlugin.cpp
    QuickMasterPlugin.cpp
    TurntablePlugin.cpp
    RecordSource.cpp
    MidiGraphPlugin.cpp
    ArpeggiatorPlugin.cpp
    ProcessMemory.cpp
    MixBlend.cpp
    SeekRelease.cpp
    ParamDump.cpp
    AudioInputs.cpp
    InputTuner.cpp
    PluginEditor.cpp
    Recording.cpp
    Recorder.cpp
    eurorack/RateBridge.cpp
    eurorack/EurorackPlugin.cpp
    eurorack/MacroOscillator2Plugin.cpp
    eurorack/MacroOscillatorPlugin.cpp
    eurorack/ResonatorPlugin.cpp
    eurorack/ModalSynthesizerPlugin.cpp
    eurorack/TextureSynthesizerPlugin.cpp
    eurorack/MetaModulatorPlugin.cpp
    eurorack/TidalModulatorPlugin.cpp
    eurorack/DrumVoicesPlugin.cpp)

add_library(studio::engine ALIAS studio_engine)

# --- The Neural Amp Modeler's DSP core ----------------------------------------
#
# An OBJECT library, and that is load-bearing. NAM's architectures register themselves
# with a file-scope static — `static Helper _register_WaveNet(...)` at the bottom of
# wavenet.cpp, and the same in lstm.cpp and convnet.cpp — and NOTHING else references
# those translation units. Compiled into a static library, the linker drops every one of
# them as unused, the factory registry ends up empty, and every model fails to load at
# runtime with "unrecognized architecture" — from a build that reported no error at all.
# An object library's members always reach the final link, so the registrations survive.
add_library(studio_nam OBJECT
    # Listed rather than globbed, so a version bump that adds or moves a file is a
    # deliberate edit here instead of a silently different binary. v0.5.4 split the
    # WaveNet into NAM/wavenet/ and added container/linear.
    ${STUDIO_NAM_DIR}/NAM/activations.cpp
    ${STUDIO_NAM_DIR}/NAM/container.cpp
    ${STUDIO_NAM_DIR}/NAM/conv1d.cpp
    ${STUDIO_NAM_DIR}/NAM/convnet.cpp
    ${STUDIO_NAM_DIR}/NAM/dsp.cpp
    ${STUDIO_NAM_DIR}/NAM/get_dsp.cpp
    ${STUDIO_NAM_DIR}/NAM/linear.cpp
    ${STUDIO_NAM_DIR}/NAM/lstm.cpp
    ${STUDIO_NAM_DIR}/NAM/ring_buffer.cpp
    ${STUDIO_NAM_DIR}/NAM/util.cpp
    ${STUDIO_NAM_DIR}/NAM/wavenet/a2_fast.cpp
    ${STUDIO_NAM_DIR}/NAM/wavenet/model.cpp
    ${STUDIO_NAM_DIR}/NAM/wavenet/slimmable.cpp)

# PUBLIC on all three: NamPlugin.cpp includes <NAM/dsp.h> and must agree with the core on
# what NAM_SAMPLE is — a header/implementation split on the sample type would be an ABI
# mismatch the compiler cannot see.
target_include_directories(studio_nam PUBLIC
    ${STUDIO_NAM_DIR}
    ${STUDIO_EIGEN_DIR}
    ${STUDIO_JSON_DIR})
target_compile_definitions(studio_nam PUBLIC NAM_SAMPLE_FLOAT=1)
# The include dir above only makes NAM's bare <json.hpp> resolve; json.hpp then includes
# its own parts as <nlohmann/...>, which needs the directory ABOVE it — what the target's
# own interface provides. Both are required.
target_link_libraries(studio_nam PUBLIC nlohmann_json::nlohmann_json)

# --- RTNeural : header templates, compiled into whoever includes them ----------
# An INTERFACE target, so tests/ runs RtNeuralModel.cpp with exactly the engine's backend and alignment.
add_library(studio_rtneural INTERFACE)
target_include_directories(studio_rtneural INTERFACE ${STUDIO_RTNEURAL_DIR} ${STUDIO_EIGEN_DIR})
target_compile_definitions(studio_rtneural INTERFACE
    RTNEURAL_USE_EIGEN=1 RTNEURAL_DEFAULT_ALIGNMENT=16 RTNEURAL_NO_DEBUG=1)
target_link_libraries(studio_rtneural INTERFACE nlohmann_json::nlohmann_json)
# Its templates overflow MSVC's section limit (C1128): JUCE gives the engine /bigobj, the tests need it from here.
target_compile_options(studio_rtneural INTERFACE $<$<CXX_COMPILER_ID:MSVC>:/bigobj>)
target_link_libraries(studio_engine PRIVATE studio_rtneural)

# The package's public headers live right here; expose this dir to consumers.
target_include_directories(studio_engine PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# The studio icon, compiled into the binary (BinaryData::studio_icon_png).
# It's the DEFAULT icon for a plugin's editor window (title bar / taskbar) when the
# plugin brings no icon of its own — see pluginIconFor() in EngineHost.cpp.
juce_add_binary_data(studio_engine_data
    SOURCES resources/studio_icon.png)

target_link_libraries(studio_engine PRIVATE
    studio_engine_data
    tracktion::tracktion_engine
    # NAM parses its model files with nlohmann/json — the same one the server already
    # uses for the wire protocol.
    nlohmann_json::nlohmann_json)

# PUBLIC so the objects reach whoever links this library — the executable. PRIVATE would
# leave them in studio_engine.lib, where the self-registering ones get dropped (see the
# object library above).
target_link_libraries(studio_engine PUBLIC studio_nam)

# --- sfizz, for SfzPlugin: an SFZ instrument as a built-in (docs/sfzPlugin.md) ---
# STUDIO_SFZ says the plugin is compiled in; every platform fetches sfizz, so it always is.
if(TARGET sfizz::sfizz)
    target_sources(studio_engine PRIVATE SfzPlugin.cpp)
    target_link_libraries(studio_engine PRIVATE sfizz::sfizz)
    target_compile_definitions(studio_engine PUBLIC STUDIO_SFZ=1)
endif()

# --- Surge XT, for SurgePlugin: a full synthesizer as a built-in (docs/surgePlugin.md) ---
# STUDIO_SURGE says the plugin is compiled in; every desktop fetches Surge, Android does not yet.
if(TARGET surge-common)
    add_subdirectory(surge)
    target_sources(studio_engine PRIVATE SurgePlugin.cpp)
    target_link_libraries(studio_engine PRIVATE studio_surge)
    target_compile_definitions(studio_engine PUBLIC STUDIO_SURGE=1)
endif()

# --- The eurorack modules' DSP, for the plugins under eurorack/ ---------------
# Its own JUCE-free library, so the firmware's macros and its TEST define reach nothing else.
add_subdirectory(eurorack)
target_link_libraries(studio_engine PRIVATE studio_eurorack)

# --- QuickJS + the Strudel bundle, for PatternPlugin --------------------------
#
# The bundle is committed (scripts/gen-strudel-bundle.mjs) and turned into a byte array at BUILD
# time, so regenerating it rebuilds without a reconfigure and the engine build needs no Node.
set(STUDIO_STRUDEL_BUNDLE "${CMAKE_CURRENT_SOURCE_DIR}/strudel/strudel.bundle.js")
set(STUDIO_STRUDEL_EMBED "${CMAKE_CURRENT_BINARY_DIR}/StrudelBundle.generated.cpp")
add_custom_command(
    OUTPUT "${STUDIO_STRUDEL_EMBED}"
    COMMAND "${CMAKE_COMMAND}" -DIN=${STUDIO_STRUDEL_BUNDLE} -DOUT=${STUDIO_STRUDEL_EMBED}
            -P "${CMAKE_CURRENT_SOURCE_DIR}/strudel/EmbedBundle.cmake"
    DEPENDS "${STUDIO_STRUDEL_BUNDLE}" "${CMAKE_CURRENT_SOURCE_DIR}/strudel/EmbedBundle.cmake"
    VERBATIM)
# Its own library, JUCE-free, so tests/ links it without Tracktion (studio_strudel_tests).
add_library(studio_strudel STATIC StrudelHost.cpp "${STUDIO_STRUDEL_EMBED}")
target_include_directories(studio_strudel PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(studio_strudel PRIVATE qjs nlohmann_json::nlohmann_json)
target_link_libraries(studio_engine PRIVATE studio_strudel)

# --- Faust, for FaustPlugin ---------------------------------------------------
#
# The static libfaust the top level fetched, plus its `architecture/` headers (that is where
# `faust/dsp/interpreter-dsp.h` and `faust/gui/UI.h` live).
#
# `staticlib` is a TARGET, not a path, and that is load-bearing: the build presets pin
# `targets: ["k7-runtime"]`, so nothing builds a library nobody depends on. Naming the file
# instead — which is what this said first — links fine on a tree where it happens to exist and
# fails with `LNK1104: cannot open libfaust.lib` on a fresh one, at the very last step of a long
# build. The generic name is Faust's own (build/CMakeLists.txt); it is not ours to rename.
target_include_directories(studio_engine PRIVATE "${STUDIO_FAUST_SRC}/architecture")
target_link_libraries(studio_engine PRIVATE staticlib)
target_compile_definitions(studio_engine PRIVATE
    STUDIO_FAUST_LIBS_DEV="${STUDIO_FAUST_LIBS}")

# DbgHelp backs the offline render's stack watchdog (see watchdogStack in OfflineRender.cpp).
# ws2_32 is Faust's: libfaust embeds an HTTP source fetcher (sourcefetcher.obj), and without
# Winsock the link fails on eight symbols that have nothing to do with anything we call.
if (WIN32)
    target_link_libraries(studio_engine PRIVATE dbghelp ws2_32)
endif()

# Headless JUCE build flags — only the engine compiles JUCE, so keep them PRIVATE.
target_compile_definitions(studio_engine PRIVATE
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    DONT_SET_USING_JUCE_NAMESPACE=1)

# Modal loops are what the CLI modes pump with (MessagePump.h). JUCE forces them off on Android, whose
# message loop is the app's Looper, and it logs assertions in RELEASE there unless told not to — which
# compiles Tracktion's debug-only `jassert (hasPrefetched)` against a member that does not exist.
# The JNI helpers are for EngineHost::run, which spins the thread's android.os.Looper (docs/android.md).
if(ANDROID)
    target_compile_definitions(studio_engine PRIVATE JUCE_LOG_ASSERTIONS=0 JUCE_CORE_INCLUDE_JNI_HELPERS=1)
    # rpmalloc, which tracktion_graph.cpp compiles in, pins its thread heap to INITIAL-EXEC TLS, and
    # Android's loader refuses that in a library opened by System.loadLibrary — the app would die
    # loading the engine. Rewriting the attribute's name makes it `__attribute__((unused))`, in that
    # one file, so the variable takes the ordinary dynamic model. An OPTION, not a definition: CMake
    # drops function-style COMPILE_DEFINITIONS without a word.
    set_source_files_properties(
        "${tracktion_engine_SOURCE_DIR}/modules/tracktion_graph/tracktion_graph.cpp"
        TARGET_DIRECTORY studio_engine
        PROPERTIES COMPILE_OPTIONS "-Dtls_model(x)=unused")
else()
    target_compile_definitions(studio_engine PRIVATE JUCE_MODAL_LOOPS_PERMITTED=1)
endif()
# Inside an app's process on both phones, where exiting takes the app with it (docs/android.md, docs/ios.md).
if(STUDIO_PHONE)
    target_compile_definitions(studio_engine PUBLIC STUDIO_ENGINE_IN_APP=1)
endif()

# ASIO is enabled in the TOP-LEVEL CMakeLists (JUCE_ASIO + the SDK's include dir):
# it has to reach the juce_audio_devices target that actually compiles the ASIO
# backend, which a PRIVATE define here would never do.
