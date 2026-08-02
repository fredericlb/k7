# lanes::engine — the audio backend package.
#
# Turns a ProjectDoc into a live Tracktion Edit and plays it. It does NOT parse
# any file format — the Node frontend (brain/) owns YAML and sends a ProjectDoc
# as JSON over the WebSocket. Tracktion is linked PRIVATE: no public header of
# this library includes it (EngineHost.h only forward-declares Tracktion types),
# so consumers — the WebSocket server — compile against this API without ever
# seeing JUCE. It still gets linked into the final executable, because a static
# library's private link deps propagate to whoever links the library.

add_library(lanes_engine STATIC
    ProjectDoc.cpp
    ProjectDiff.cpp
    EngineHost.cpp
    AudioDevices.cpp
    PluginParams.cpp
    Warnings.cpp
    PluginScan.cpp
    EditBuilder.cpp
    OfflineRender.cpp
    Waveform.cpp
    WaveformTapPlugin.cpp
    BroadcastTapPlugin.cpp
    NamPlugin.cpp
    DspGraph.cpp
    GraphDspPlugin.cpp
    MixerPlugin.cpp
    MidiGraphPlugin.cpp
    NormalizeClips.cpp
    ParamDump.cpp
    AudioInputs.cpp
    InputTuner.cpp
    PluginEditor.cpp
    Recording.cpp)

add_library(lanes::engine ALIAS lanes_engine)

# --- The Neural Amp Modeler's DSP core ----------------------------------------
#
# An OBJECT library, and that is load-bearing. NAM's architectures register themselves
# with a file-scope static — `static Helper _register_WaveNet(...)` at the bottom of
# wavenet.cpp, and the same in lstm.cpp and convnet.cpp — and NOTHING else references
# those translation units. Compiled into a static library, the linker drops every one of
# them as unused, the factory registry ends up empty, and every model fails to load at
# runtime with "unrecognized architecture" — from a build that reported no error at all.
# An object library's members always reach the final link, so the registrations survive.
add_library(lanes_nam OBJECT
    # Listed rather than globbed, so a version bump that adds or moves a file is a
    # deliberate edit here instead of a silently different binary. v0.5.4 split the
    # WaveNet into NAM/wavenet/ and added container/linear.
    ${LANES_NAM_DIR}/NAM/activations.cpp
    ${LANES_NAM_DIR}/NAM/container.cpp
    ${LANES_NAM_DIR}/NAM/conv1d.cpp
    ${LANES_NAM_DIR}/NAM/convnet.cpp
    ${LANES_NAM_DIR}/NAM/dsp.cpp
    ${LANES_NAM_DIR}/NAM/get_dsp.cpp
    ${LANES_NAM_DIR}/NAM/linear.cpp
    ${LANES_NAM_DIR}/NAM/lstm.cpp
    ${LANES_NAM_DIR}/NAM/ring_buffer.cpp
    ${LANES_NAM_DIR}/NAM/util.cpp
    ${LANES_NAM_DIR}/NAM/wavenet/a2_fast.cpp
    ${LANES_NAM_DIR}/NAM/wavenet/model.cpp
    ${LANES_NAM_DIR}/NAM/wavenet/slimmable.cpp)

# PUBLIC on all three: NamPlugin.cpp includes <NAM/dsp.h> and must agree with the core on
# what NAM_SAMPLE is — a header/implementation split on the sample type would be an ABI
# mismatch the compiler cannot see.
target_include_directories(lanes_nam PUBLIC
    ${LANES_NAM_DIR}
    ${LANES_EIGEN_DIR}
    ${LANES_JSON_DIR})
target_compile_definitions(lanes_nam PUBLIC NAM_SAMPLE_FLOAT=1)
# The include dir above only makes NAM's bare <json.hpp> resolve; json.hpp then includes
# its own parts as <nlohmann/...>, which needs the directory ABOVE it — what the target's
# own interface provides. Both are required.
target_link_libraries(lanes_nam PUBLIC nlohmann_json::nlohmann_json)

# The package's public headers live right here; expose this dir to consumers.
target_include_directories(lanes_engine PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# The lanes icon, compiled into the binary (BinaryData::lanes_icon_png).
# It's the DEFAULT icon for a plugin's editor window (title bar / taskbar) when the
# plugin brings no icon of its own — see pluginIconFor() in EngineHost.cpp.
juce_add_binary_data(lanes_engine_data
    SOURCES resources/lanes_icon.png)

target_link_libraries(lanes_engine PRIVATE
    lanes_engine_data
    tracktion::tracktion_engine
    # NAM parses its model files with nlohmann/json — the same one the server already
    # uses for the wire protocol.
    nlohmann_json::nlohmann_json)

# PUBLIC so the objects reach whoever links this library — the executable. PRIVATE would
# leave them in lanes_engine.lib, where the self-registering ones get dropped (see the
# object library above).
target_link_libraries(lanes_engine PUBLIC lanes_nam)

# DbgHelp backs the offline render's stack watchdog (see watchdogStack in OfflineRender.cpp).
if (WIN32)
    target_link_libraries(lanes_engine PRIVATE dbghelp)
endif()

# Headless JUCE build flags — only the engine compiles JUCE, so keep them PRIVATE.
target_compile_definitions(lanes_engine PRIVATE
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    DONT_SET_USING_JUCE_NAMESPACE=1)

# ASIO is enabled in the TOP-LEVEL CMakeLists (JUCE_ASIO + the SDK's include dir):
# it has to reach the juce_audio_devices target that actually compiles the ASIO
# backend, which a PRIVATE define here would never do.
