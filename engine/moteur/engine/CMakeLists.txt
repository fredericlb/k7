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
    Waveform.cpp
    WaveformTapPlugin.cpp
    BroadcastTapPlugin.cpp
    NamPlugin.cpp
    DspGraph.cpp
    GraphDspPlugin.cpp
    MasterGainPlugin.cpp
    MixerPlugin.cpp
    MidiGraphPlugin.cpp
    FilePeak.cpp
    ParamDump.cpp
    AudioInputs.cpp
    InputTuner.cpp
    PluginEditor.cpp
    Recording.cpp)

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

# DbgHelp backs the offline render's stack watchdog (see watchdogStack in OfflineRender.cpp).
if (WIN32)
    target_link_libraries(studio_engine PRIVATE dbghelp)
endif()

# Headless JUCE build flags — only the engine compiles JUCE, so keep them PRIVATE.
target_compile_definitions(studio_engine PRIVATE
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    DONT_SET_USING_JUCE_NAMESPACE=1)

# ASIO is enabled in the TOP-LEVEL CMakeLists (JUCE_ASIO + the SDK's include dir):
# it has to reach the juce_audio_devices target that actually compiles the ASIO
# backend, which a PRIVATE define here would never do.
