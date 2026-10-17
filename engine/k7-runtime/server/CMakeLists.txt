# k7-runtime (app) — the WebSocket audio server.
#
# Consumes studio::engine (which hides JUCE/Tracktion), plus IXWebSocket and
# nlohmann/json. It includes no JUCE headers itself.
#
# On Android the same target is a SHARED library, libk7runtime.so, with no main(): JUCE's Oboe
# backend reaches Java, so the engine is loaded into the app rather than spawned, and the app
# calls serve() through android/EngineJni.cpp (docs/android.md). On iOS it is a FRAMEWORK,
# k7runtime.framework, for the same reason and one more — no app may run a program of its own (docs/ios.md).

set(STUDIO_SERVER_SOURCES
    Serve.cpp
    ServeProject.cpp
    ServePlugins.cpp
    ServeMachine.cpp
    ServePairing.cpp
    Pairing.cpp
    AudioSender.cpp
    DocJson.cpp
    # The NAM core's objects, on the FINAL link line rather than only inside
    # studio_engine.lib. Its architectures register themselves from a file-scope static
    # that nothing references (see engine/CMakeLists.txt), so as archive members they are
    # dropped and every .nam model fails to load at runtime — from a build that reported
    # nothing wrong. Objects named here are always linked.
    $<TARGET_OBJECTS:studio_nam>)

if(ANDROID)
    add_library(k7-runtime SHARED ${STUDIO_SERVER_SOURCES} android/EngineJni.cpp)
    set_target_properties(k7-runtime PROPERTIES
        OUTPUT_NAME k7runtime
        LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
    # Oboe's AAudio/OpenSL ES and JUCE's logging, which the JUCE module sources compiled into
    # studio_engine call but do not link themselves.
    target_link_libraries(k7-runtime PRIVATE android log OpenSLES)
elseif(IOS)
    add_library(k7-runtime SHARED ${STUDIO_SERVER_SOURCES} ios/EngineEmbed.cpp)
    set_target_properties(k7-runtime PROPERTIES
        FRAMEWORK TRUE
        OUTPUT_NAME k7runtime
        MACOSX_FRAMEWORK_IDENTIFIER se.frediver.k7.runtime
        LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
else()
    add_executable(k7-runtime main.cpp ${STUDIO_SERVER_SOURCES})
    # Keep the binary at build/<preset>/k7-runtime.
    set_target_properties(k7-runtime PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
endif()

target_link_libraries(k7-runtime PRIVATE
    studio::engine
    ixwebsocket
    nlohmann_json::nlohmann_json)
