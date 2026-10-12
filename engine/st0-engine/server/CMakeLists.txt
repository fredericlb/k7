# st0-engine (app) — the WebSocket audio server.
#
# Consumes studio::engine (which hides JUCE/Tracktion), plus IXWebSocket and
# nlohmann/json. It includes no JUCE headers itself.
#
# On Android the same target is a SHARED library, libst0engine.so, with no main(): JUCE's Oboe
# backend reaches Java, so the engine is loaded into the app rather than spawned, and the app
# calls serve() through android/EngineJni.cpp (docs/android.md).

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
    add_library(st0-engine SHARED ${STUDIO_SERVER_SOURCES} android/EngineJni.cpp)
    set_target_properties(st0-engine PROPERTIES
        OUTPUT_NAME st0engine
        LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
    # Oboe's AAudio/OpenSL ES and JUCE's logging, which the JUCE module sources compiled into
    # studio_engine call but do not link themselves.
    target_link_libraries(st0-engine PRIVATE android log OpenSLES)
else()
    add_executable(st0-engine main.cpp ${STUDIO_SERVER_SOURCES})
    # Keep the binary at build/<preset>/st0-engine.
    set_target_properties(st0-engine PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
endif()

target_link_libraries(st0-engine PRIVATE
    studio::engine
    ixwebsocket
    nlohmann_json::nlohmann_json)
