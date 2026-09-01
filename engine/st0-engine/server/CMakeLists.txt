# st0-engine (app) — the WebSocket audio server.
#
# Consumes studio::engine (which hides JUCE/Tracktion), plus IXWebSocket and
# nlohmann/json. It includes no JUCE headers itself.

add_executable(st0-engine
    main.cpp
    # The NAM core's objects, on the EXECUTABLE's link line rather than only inside
    # studio_engine.lib. Its architectures register themselves from a file-scope static
    # that nothing references (see engine/CMakeLists.txt), so as archive members they are
    # dropped and every .nam model fails to load at runtime — from a build that reported
    # nothing wrong. Objects named here are always linked.
    $<TARGET_OBJECTS:studio_nam>)

target_link_libraries(st0-engine PRIVATE
    studio::engine
    ixwebsocket
    nlohmann_json::nlohmann_json)

# Keep the binary at build/<preset>/st0-engine.
set_target_properties(st0-engine PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
