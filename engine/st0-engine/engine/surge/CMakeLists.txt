# studio_surge — Surge XT's synthesizer behind a JUCE-free core, for SurgePlugin.
#
# Its own library for the eurorack cores' reason: surge-common exports MAC=1, WINDOWS=1, UNICODE and its
# block size as PUBLIC definitions, and linked PRIVATE here they reach this one translation unit and
# nothing that includes JUCE. The Tracktion plugin around it is in studio_engine. docs/surgePlugin.md.

add_library(studio_surge STATIC SurgeCore.cpp)
target_include_directories(studio_surge PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(studio_surge PRIVATE surge-common)
# The renames every Surge source is compiled with, so this one reads its headers the same way (../../CMakeLists.txt).
target_compile_definitions(studio_surge PRIVATE ${STUDIO_SURGE_RENAMES})
# Surge's headers are written for C++20 WITHOUT char8_t, which is how Surge compiles its own sources.
target_compile_options(studio_surge PRIVATE
    $<$<CXX_COMPILER_ID:MSVC>:/Zc:char8_t->
    $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-fno-char8_t>)
