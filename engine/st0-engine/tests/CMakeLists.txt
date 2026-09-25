# Engine unit tests — the JUCE-free data layer only.
#
# Deliberately does NOT link studio_engine (which pulls in Tracktion/JUCE). Instead
# it compiles the two plain-data TUs straight into the test binary, so the tests build
# in seconds and run headless with no audio device — exactly what docs/design.md means
# by "diffable and unit-testable without an audio device".

add_executable(studio_engine_tests
    ProjectDiff_test.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine/ProjectDoc.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine/ProjectDiff.cpp
    # index() names a duplicate id rather than dropping it in silence. Warnings.cpp is JUCE-free, so
    # this keeps the "builds in seconds, no audio device" property the comment above is about.
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine/Warnings.cpp)

# The data-layer headers (ProjectDoc.h / ProjectDiff.h) live in ../engine.
target_include_directories(studio_engine_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)

add_test(NAME studio_engine_tests COMMAND studio_engine_tests)

# --- Session registry tests ---------------------------------------------------
# A THIRD fast binary, kept apart only because each test file owns a main(). SessionRegistry.h is
# header-only and JUCE-free, so this links nothing and shares the "builds in seconds" property.
add_executable(studio_session_tests SessionRegistry_test.cpp)
target_include_directories(studio_session_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_session_tests COMMAND studio_session_tests)

# --- Turntable loop tests -----------------------------------------------------
# A FOURTH fast binary, same reason as the one above: TurntableLoop.h is header-only and JUCE-free,
# so the loop's arithmetic is tested without linking Tracktion. The PLUGIN around it still is not
# — applyToBuffer needs a live te::Edit, which is what scripts/turntable.ts drives instead.
add_executable(studio_turntable_tests TurntableLoop_test.cpp)
target_include_directories(studio_turntable_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_turntable_tests COMMAND studio_turntable_tests)

# --- Recorder ring tests ------------------------------------------------------
# A FIFTH fast binary, for the reason the two above give: RecorderTap.h is header-only and
# JUCE-free, so the one property no eye can check — that an overrun is COUNTED rather than
# forgiven — is tested without linking Tracktion. See ../docs/recorder.md.
add_executable(studio_recorder_tests RecorderTap_test.cpp)
target_include_directories(studio_recorder_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_recorder_tests COMMAND studio_recorder_tests)

# --- Arpeggiator tests --------------------------------------------------------
# A SIXTH fast binary, same reason as the three above: Arpeggiator.h is header-only and JUCE-free,
# so the clock and the walk are tested without linking Tracktion. The PLUGIN around it needs a live
# te::Edit no suite here builds — see ../docs/arpeggiator.md.
add_executable(studio_arp_tests Arpeggiator_test.cpp)
target_include_directories(studio_arp_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_arp_tests COMMAND studio_arp_tests)

# --- Note clock tests ---------------------------------------------------------
# A SEVENTH fast binary, for the reason the arpeggiator's gives: NoteClock.h is header-only and
# JUCE-free, so the held set, the clock and the gate are tested without linking Tracktion. The
# GRAPH nodes over it need a MidiMessageArray and are in studio_midigraph_tests — ../docs/midiGraph.md.
add_executable(studio_noteclock_tests NoteClock_test.cpp)
target_include_directories(studio_noteclock_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_noteclock_tests COMMAND studio_noteclock_tests)

# --- Callback watchdog tests --------------------------------------------------
# Another fast binary, for the reason the ones above give: CallbackWatchdog.h is header-only and
# JUCE-free, so WHEN a stalled device is reopened is tested without linking Tracktion. The reopen
# itself needs a live device no suite here opens — ../docs/audioDevice.md.
add_executable(studio_watchdog_tests CallbackWatchdog_test.cpp)
target_include_directories(studio_watchdog_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_watchdog_tests COMMAND studio_watchdog_tests)

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
# `slow` is what keeps this out of `npm run test`: linking Tracktion can cost minutes — ../../../docs/tests.md.
set_tests_properties(studio_midigraph_tests PROPERTIES LABELS slow)


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
# Slow for the same reason as the MIDI one, and opt-in the same way.
set_tests_properties(studio_dspgraph_tests PROPERTIES LABELS slow)

# --- Faust tests --------------------------------------------------------------
# Faust compiled by the engine's own libfaust. JUCE-FREE, unlike the two above: it links libfaust
# and nothing else, so it keeps the "builds in seconds, no audio device" property. One case walks a
# module LIBRARY, named at run time by `$STUDIO_MODULES` rather than baked in here: this repo ships
# no modules, and a library is a per-account path no build could know.
add_executable(studio_faust_tests Faust_test.cpp)
target_link_libraries(studio_faust_tests PRIVATE staticlib)
target_include_directories(studio_faust_tests PRIVATE
    "${STUDIO_FAUST_SRC}/architecture"
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
# NOMINMAX because Faust's poly-dsp.h reaches <windows.h>, whose `max`/`min` MACROS then eat
# every `std::max(` as an illegal token after `::`. The engine's own TU dodges it by using
# juce::jmax; this binary is JUCE-free on purpose, so it says so instead. Same rule the root
# CMakeLists already states for <shellapi.h>.
target_compile_definitions(studio_faust_tests PRIVATE
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    STUDIO_FAUST_LIBS="${STUDIO_FAUST_LIBS}")
if (WIN32)
    target_link_libraries(studio_faust_tests PRIVATE ws2_32)
endif()
add_test(NAME studio_faust_tests COMMAND studio_faust_tests)

# --- Pattern lane tests -------------------------------------------------------
# Two fast binaries for PatternPlugin's two JUCE-free halves: the schedule between the worker and the
# audio thread (header-only), and the QuickJS host with the embedded Strudel bundle (studio_strudel).
# The plugin around them needs a live te::Edit — its proof is an offline render, ../docs/patternPlugin.md.
add_executable(studio_pattern_tests PatternSchedule_test.cpp)
target_include_directories(studio_pattern_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../engine)
add_test(NAME studio_pattern_tests COMMAND studio_pattern_tests)

add_executable(studio_strudel_tests StrudelHost_test.cpp)
target_link_libraries(studio_strudel_tests PRIVATE studio_strudel)
add_test(NAME studio_strudel_tests COMMAND studio_strudel_tests)
