# Engine unit tests — the JUCE-free data layer only.
#
# Deliberately does NOT link studio_engine (which pulls in Tracktion/JUCE). Instead
# it compiles the two plain-data TUs straight into the test binary, so the tests build
# in seconds and run headless with no audio device — exactly what docs/design.md means
# by "diffable and unit-testable without an audio device".

add_executable(studio_engine_tests
    ProjectDiff_test.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine/ProjectDoc.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine/ProjectDiff.cpp)

# The data-layer headers (ProjectDoc.h / ProjectDiff.h) live in ../engine.
target_include_directories(studio_engine_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)

add_test(NAME studio_engine_tests COMMAND studio_engine_tests)

# --- MIDI graph tests ---------------------------------------------------------
# A SECOND binary, because these need Tracktion's MidiMessageArray and so must link the engine — which is exactly
# what the target above avoids. Keeping them apart preserves the fast tests' "builds in seconds, no audio device"
# property; this one is slower and is why it is opt-in the same way.
add_executable(studio_midigraph_tests MidiGraph_test.cpp)
# Tracktion is linked PRIVATE by studio_engine — the library hides JUCE from its consumers on purpose. But
# DspGraph.h is an INTERNAL header and does include it, so a test that includes it has to link Tracktion itself,
# with the same headless defines the engine compiles under.
target_link_libraries(studio_midigraph_tests PRIVATE
    studio_engine
    tracktion::tracktion_engine)
target_include_directories(studio_midigraph_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
target_compile_definitions(studio_midigraph_tests PRIVATE
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    DONT_SET_USING_JUCE_NAMESPACE=1)
add_test(NAME studio_midigraph_tests COMMAND studio_midigraph_tests)


# --- DSP graph tests ----------------------------------------------------------
# Same deal as the MIDI ones: DspGraph.h is internal and includes Tracktion, so this links it too. Kept apart
# from MidiGraph_test.cpp only because each owns a main().
add_executable(studio_dspgraph_tests DspGraph_test.cpp)
target_link_libraries(studio_dspgraph_tests PRIVATE
    studio_engine
    tracktion::tracktion_engine)
target_include_directories(studio_dspgraph_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
target_compile_definitions(studio_dspgraph_tests PRIVATE
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    DONT_SET_USING_JUCE_NAMESPACE=1)
add_test(NAME studio_dspgraph_tests COMMAND studio_dspgraph_tests)
