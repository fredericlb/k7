# st0-supervisor — the engine machine's supervisor, a native program driven by the tray over NDJSON
# on stdio. Its own project rather than a target of st0-engine's: building it must never mean
# building Tracktion, JUCE and Faust. See docs/supervisor.md.

cmake_minimum_required(VERSION 3.24)

project(St0Supervisor VERSION 0.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(MSVC)
    add_compile_options(/MP /FS /utf-8)
endif()
# Every dependency is linked statically into one executable; position-independent code keeps that legal on Linux.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# Nothing here is installed, and a dependency's export set would name our mbedTLS targets, which none holds.
set(CMAKE_SKIP_INSTALL_RULES ON)

include(FetchContent)

# --- nlohmann/json : every frame and every settings file, the same tag as the engine's --------
FetchContent_Declare(nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    ON)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)

# --- mbedTLS : the one TLS stack, statically linked on all three platforms (docs/supervisor.md) ---
# The release archive rather than the git tag: the tag lacks the generated sources a build needs.
FetchContent_Declare(mbedtls
    URL      https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.5/mbedtls-3.6.5.tar.bz2
    URL_HASH SHA256=4a11f1777bb95bf4ad96721cac945a26e04bf19f57d905f241fe77ebeddf46d8)
set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
set(USE_STATIC_MBEDTLS_LIBRARY ON CACHE BOOL "" FORCE)
set(MBEDTLS_USER_CONFIG_FILE ${CMAKE_CURRENT_SOURCE_DIR}/cmake/mbedtls_user_config.h CACHE FILEPATH "" FORCE)
FetchContent_MakeAvailable(nlohmann_json mbedtls)
# The one name libdatachannel asks for, over the three libraries mbedTLS builds.
add_library(st0_mbedtls INTERFACE)
target_link_libraries(st0_mbedtls INTERFACE mbedtls mbedx509 mbedcrypto)
add_library(MbedTLS::MbedTLS ALIAS st0_mbedtls)

# --- IXWebSocket : the engine socket, the tunnel, and HTTPS, all over the mbedTLS above ---------
FetchContent_Declare(ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG        v12.0.1
    GIT_SHALLOW    ON)
set(USE_TLS ON CACHE BOOL "" FORCE)
set(USE_MBED_TLS ON CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)
# Told where the fetched mbedTLS is, since its FindMbedTLS looks only for an installed one.
set(MBEDTLS_FOUND TRUE)
set(MBEDTLS_INCLUDE_DIRS ${mbedtls_SOURCE_DIR}/include)
set(MBEDTLS_LIBRARIES mbedtls mbedx509 mbedcrypto)
FetchContent_MakeAvailable(ixwebsocket)
# The define its finder would have set for an mbedTLS 3, skipped because we said it was found.
target_compile_definitions(ixwebsocket PRIVATE IXWEBSOCKET_USE_MBED_TLS_MIN_VERSION_3)

# --- libdatachannel : the WebRTC path to a browser, DTLS over the same mbedTLS (docs/supervisor.md) ---
# Data channels only: no media, no WebSocket of its own, and the three submodules that needs.
FetchContent_Declare(libdatachannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG        v0.24.5
    GIT_SHALLOW    ON
    GIT_SUBMODULES "deps/plog;deps/usrsctp;deps/libjuice")
set(USE_MBEDTLS ON CACHE BOOL "" FORCE)
set(NO_MEDIA ON CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(libdatachannel)

# --- the program ----------------------------------------------------------------------------------
# Everything but main.cpp is a library, so the tests link exactly what ships.
add_library(st0_supervisor_core STATIC
    src/Loop.cpp
    src/Paths.cpp
    src/Log.cpp
    src/Process.cpp
    src/Settings.cpp
    src/Identity.cpp
    src/HostLock.cpp
    src/Url.cpp
    src/HostProtocol.cpp
    src/AudioPolicy.cpp
    src/EngineProcess.cpp
    src/EngineQueries.cpp
    src/TrustRoots.cpp
    src/Http.cpp
    src/Registry.cpp
    src/Addresses.cpp
    src/Performance.cpp
    src/FileTime.cpp
    src/TunnelFrames.cpp
    src/TunnelFiles.cpp
    src/PathMap.cpp
    src/TunnelAgent.cpp
    src/MachineJobs.cpp
    src/RtcFrames.cpp
    src/Rtc.cpp
    src/Separation.cpp
    src/Supervisor.cpp)
target_include_directories(st0_supervisor_core PUBLIC src)
target_link_libraries(st0_supervisor_core PUBLIC nlohmann_json::nlohmann_json ixwebsocket datachannel mbedtls mbedx509 mbedcrypto)
if(WIN32)
    target_link_libraries(st0_supervisor_core PUBLIC ws2_32 iphlpapi crypt32)
    target_compile_definitions(st0_supervisor_core PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN)
endif()
if(APPLE)
    target_link_libraries(st0_supervisor_core PUBLIC "-framework Security" "-framework CoreFoundation")
endif()

add_executable(st0-supervisor src/main.cpp)
target_link_libraries(st0-supervisor PRIVATE st0_supervisor_core)

# --- tests: the engine's tiny harness, one binary, no device and no network -----------------------
enable_testing()
add_executable(st0_supervisor_tests
    tests/main_test.cpp
    tests/Url_test.cpp
    tests/Settings_test.cpp
    tests/HostProtocol_test.cpp
    tests/AudioPolicy_test.cpp
    tests/Performance_test.cpp
    tests/MachineJobs_test.cpp
    tests/RtcFrames_test.cpp)
target_include_directories(st0_supervisor_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../st0-engine/tests)
target_link_libraries(st0_supervisor_tests PRIVATE st0_supervisor_core)
add_test(NAME st0_supervisor_tests COMMAND st0_supervisor_tests)

# The agent alone, for packages/engine-tunnel's suites to run against the real TypeScript hub.
add_executable(tunnel_harness tests/tunnel_harness.cpp)
target_link_libraries(tunnel_harness PRIVATE st0_supervisor_core)
