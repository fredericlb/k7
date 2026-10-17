# k7-supervisor — the engine machine's supervisor, a native program driven by the tray over NDJSON
# on stdio. Its own project rather than a target of k7-runtime's: building it must never mean
# building Tracktion, JUCE and Faust. See docs/supervisor.md.

cmake_minimum_required(VERSION 3.24)

project(K7Supervisor VERSION 0.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(MSVC)
    add_compile_options(/utf-8)
endif()
# /MP for MSBuild, which runs cl once per file; under Ninja it does nothing, and a compiler cache refuses it.
if(MSVC AND CMAKE_GENERATOR MATCHES "Visual Studio")
    add_compile_options(/MP /FS)
endif()
# The Visual Studio generator defines _MBCS on every target and Ninja does not: the same build under both.
if(MSVC AND NOT CMAKE_GENERATOR MATCHES "Visual Studio")
    add_compile_definitions(_MBCS)
endif()
# Every dependency is linked statically into one executable; position-independent code keeps that legal on Linux.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# Nothing here is installed, and a dependency's export set would name our mbedTLS targets, which none holds.
set(CMAKE_SKIP_INSTALL_RULES ON)

include(FetchContent)

# Every download SAID, with its progress: a first configure fetches hundreds of MB, and a silent one
# reads as a hang in a CI log. GIT_PROGRESS on each git source below is the other half.
set(FETCHCONTENT_QUIET OFF)

# $STUDIO_FETCHCONTENT_DIR, which CI sets and keeps between runs, holds every download instead of the
# build tree, so a fresh build clones nothing; this project gets its own folder in it. A folder of
# SOURCES only: the job deletes what gets built in it, which differs per preset and per target.
if(NOT "$ENV{STUDIO_FETCHCONTENT_DIR}" STREQUAL "")
    set(FETCHCONTENT_BASE_DIR "$ENV{STUDIO_FETCHCONTENT_DIR}/k7-supervisor" CACHE PATH "" FORCE)
    set(FETCHCONTENT_UPDATES_DISCONNECTED ON)
endif()

# The patch command carries the script's checksum, so a kept source tree re-runs a patch edited since.
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/cmake/patch_ixwebsocket.cmake" STUDIO_PATCH_SUM)

# --- nlohmann/json : every frame and every settings file, the same tag as the engine's --------
# Upstream's release archive for FetchContent: the headers and the CMake files, 0.1 MB against a clone's 186.
FetchContent_Declare(nlohmann_json
    URL      https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d)
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
# `threading.h` includes "threading_alt.h" by name, so our copy must be on every mbedTLS target's path.
if(WIN32)
    foreach(lib mbedtls mbedx509 mbedcrypto)
        target_include_directories(${lib} PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/cmake)
    endforeach()
endif()
# The one name libdatachannel asks for, over the three libraries mbedTLS builds.
add_library(k7_mbedtls INTERFACE)
target_link_libraries(k7_mbedtls INTERFACE mbedtls mbedx509 mbedcrypto)
add_library(MbedTLS::MbedTLS ALIAS k7_mbedtls)

# --- miniz : unpacks the instruments the supervisor downloads (Instruments.cpp, docs/instruments.md) ----
# MIT, one C file. The release archive is the amalgamated miniz.c/miniz.h, compiled here as it is.
FetchContent_Declare(miniz
    URL      https://github.com/richgel999/miniz/releases/download/3.0.2/miniz-3.0.2.zip
    URL_HASH SHA256=ada38db0b703a56d3dd6d57bf84a9c5d664921d870d8fea4db153979fb5332c5)
# The archive holds no CMakeLists.txt, so making it available only unpacks it.
FetchContent_MakeAvailable(miniz)
add_library(k7_miniz STATIC ${miniz_SOURCE_DIR}/miniz.c)
target_include_directories(k7_miniz PUBLIC ${miniz_SOURCE_DIR})
set_target_properties(k7_miniz PROPERTIES POSITION_INDEPENDENT_CODE ON)

# --- IXWebSocket : the engine socket, the tunnel, and HTTPS, all over the mbedTLS above ---------
FetchContent_Declare(ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_PROGRESS   ON
    GIT_TAG        v12.0.1
    GIT_SHALLOW    ON
    # A TLS write left pending is retried at its own length, or a big upload corrupts the tunnel (docs/supervisor.md).
    PATCH_COMMAND  ${CMAKE_COMMAND} -DSTUDIO_PATCH_SUM=${STUDIO_PATCH_SUM} -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/patch_ixwebsocket.cmake)
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
    GIT_PROGRESS   ON
    GIT_TAG        v0.24.5
    GIT_SHALLOW    ON
    GIT_SUBMODULES "deps/plog;deps/usrsctp;deps/libjuice")
set(USE_MBEDTLS ON CACHE BOOL "" FORCE)
set(NO_MEDIA ON CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(libdatachannel)

# --- ONNX Runtime : stem separation, the prebuilt library per platform, hashes pinned ---------------
# A SHARED library, loaded at run time from beside the executable or the tray's resources. Windows
# takes the DirectML package, which stops at 1.24; a platform with no binary builds without separation.
# Android is one: it is UNIX and aarch64, but the linux-aarch64 build is glibc and loads on no phone.
set(K7_ORT_URL "")
if(APPLE AND NOT IOS AND (CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64" OR CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"))
    set(K7_ORT_URL https://github.com/microsoft/onnxruntime/releases/download/v1.30.0/onnxruntime-osx-arm64-1.30.0.tgz)
    set(K7_ORT_HASH 6ebb5062a934537c352937821f9fe9718e7de1a2db1122a93dd363ffd53a7012)
elseif(WIN32 AND CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(K7_ORT_URL https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.24.4/microsoft.ml.onnxruntime.directml.1.24.4.nupkg)
    set(K7_ORT_HASH 57e9f11b73437bef7a309496135d4c1f96b1a8e9ddba60013fa27bfc1d788681)
elseif(UNIX AND NOT APPLE AND NOT ANDROID AND CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
    set(K7_ORT_URL https://github.com/microsoft/onnxruntime/releases/download/v1.30.0/onnxruntime-linux-x64-1.30.0.tgz)
    set(K7_ORT_HASH a5ed5a3cac51fbb2e90da632ae43d19212faaa20e76484e62bcb7c23ddb3b3fd)
elseif(UNIX AND NOT APPLE AND NOT ANDROID AND CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    set(K7_ORT_URL https://github.com/microsoft/onnxruntime/releases/download/v1.30.0/onnxruntime-linux-aarch64-1.30.0.tgz)
    set(K7_ORT_HASH e16a27a8ed330bbc698df7330b0cf56e722f354e3bcc92118682c74ef3c3e3da)
endif()
set(K7_ORT_RUNTIME "")
if(K7_ORT_URL)
    FetchContent_Declare(onnxruntime URL ${K7_ORT_URL} URL_HASH SHA256=${K7_ORT_HASH} DOWNLOAD_EXTRACT_TIMESTAMP ON)
    FetchContent_MakeAvailable(onnxruntime)
    # Headers only: the library is LOADED at the first separation, never linked (src/OnnxSession.cpp).
    add_library(k7_onnxruntime INTERFACE)
    if(WIN32)
        target_include_directories(k7_onnxruntime INTERFACE ${onnxruntime_SOURCE_DIR}/build/native/include)
        # DirectML itself, which the ORT package expects to find beside it.
        FetchContent_Declare(directml
            URL      https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg
            URL_HASH SHA256=4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9
            DOWNLOAD_EXTRACT_TIMESTAMP ON)
        FetchContent_MakeAvailable(directml)
        set(K7_ORT_RUNTIME ${onnxruntime_SOURCE_DIR}/runtimes/win-x64/native/onnxruntime.dll
                            ${onnxruntime_SOURCE_DIR}/runtimes/win-x64/native/onnxruntime_providers_shared.dll
                            ${directml_SOURCE_DIR}/bin/x64-win/DirectML.dll)
    else()
        file(GLOB K7_ORT_LIB ${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.so.1.* ${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.1.*.dylib)
        list(FILTER K7_ORT_LIB EXCLUDE REGEX "dSYM")
        list(GET K7_ORT_LIB 0 K7_ORT_LIB)
        target_include_directories(k7_onnxruntime INTERFACE ${onnxruntime_SOURCE_DIR}/include)
        set(K7_ORT_RUNTIME ${K7_ORT_LIB})
    endif()
else()
    message(STATUS "ONNX Runtime ships no binary for this platform: building without stem separation")
endif()

# --- the program ----------------------------------------------------------------------------------
# Everything but main.cpp is a library, so the tests link exactly what ships.
add_library(k7_supervisor_core STATIC
    src/Loop.cpp
    src/Crash.cpp
    src/Paths.cpp
    src/Log.cpp
    src/Processes.cpp
    src/PidFile.cpp
    src/Settings.cpp
    src/Identity.cpp
    src/HostLock.cpp
    src/Url.cpp
    src/HostProtocol.cpp
    src/AudioPolicy.cpp
    src/EngineProcess.cpp
    src/CrashLoop.cpp
    src/WireVersion.cpp
    src/EngineQueries.cpp
    src/TrustRoots.cpp
    src/Tls.cpp
    src/Http.cpp
    src/Registry.cpp
    src/Addresses.cpp
    src/Performance.cpp
    src/FileTime.cpp
    src/TunnelFrames.cpp
    src/Backpressure.cpp
    src/TunnelFiles.cpp
    src/PathMap.cpp
    src/TunnelAgent.cpp
    src/MachineJobs.cpp
    src/RtcFrames.cpp
    src/Rtc.cpp
    src/SeparationAudio.cpp
    src/OnnxSession.cpp
    src/Separation.cpp
    src/Instruments.cpp
    src/Supervisor.cpp)
# The release stamp the heartbeat and the adoption check use, on its one source alone so a new stamp recompiles one file.
set(K7_BUILD_STAMP "$ENV{STUDIO_RELEASE_STAMP}")
string(REGEX REPLACE "[^A-Za-z0-9._-]" "" K7_BUILD_STAMP "${K7_BUILD_STAMP}")
# A snapshot or a local build names the version it was cut from, the root's, which k7-runtime's package.json copies (docs/versioning.md).
file(READ "${CMAKE_CURRENT_LIST_DIR}/../k7-runtime/package.json" K7_PACKAGE_JSON)
string(JSON K7_VERSION GET "${K7_PACKAGE_JSON}" version)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/../k7-runtime/package.json")
if(K7_BUILD_STAMP STREQUAL "")
    set(K7_BUILD_STAMP "${K7_VERSION}-dev")
elseif(NOT K7_BUILD_STAMP MATCHES "^v[0-9]")
    set(K7_BUILD_STAMP "${K7_VERSION}-${K7_BUILD_STAMP}")
endif()
set_source_files_properties(src/WireVersion.cpp PROPERTIES COMPILE_DEFINITIONS "K7_BUILD=\"${K7_BUILD_STAMP}\"")
# `src` is searched before the system headers, and Windows ignores case: no header here may share a system header's name.
target_include_directories(k7_supervisor_core PUBLIC src)
target_link_libraries(k7_supervisor_core PUBLIC nlohmann_json::nlohmann_json ixwebsocket datachannel mbedtls mbedx509 mbedcrypto k7_miniz)
if(WIN32)
    target_link_libraries(k7_supervisor_core PUBLIC ws2_32 iphlpapi crypt32 dbghelp)
    target_compile_definitions(k7_supervisor_core PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN)
endif()
if(APPLE)
    target_link_libraries(k7_supervisor_core PUBLIC "-framework Security" "-framework CoreFoundation")
endif()
if(K7_ORT_URL)
    target_link_libraries(k7_supervisor_core PUBLIC k7_onnxruntime ${CMAKE_DL_LIBS})
    target_compile_definitions(k7_supervisor_core PUBLIC K7_WITH_ONNX)
    if(WIN32)
        target_link_libraries(k7_supervisor_core PUBLIC dxgi)
    endif()
endif()

# The runtime library beside every executable of the build, the first place the loader looks.
function(k7_beside_runtime target)
    foreach(lib ${K7_ORT_RUNTIME})
        add_custom_command(TARGET ${target} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different ${lib} $<TARGET_FILE_DIR:${target}>)
    endforeach()
endfunction()

add_executable(k7-supervisor src/main.cpp)
target_link_libraries(k7-supervisor PRIVATE k7_supervisor_core)
k7_beside_runtime(k7-supervisor)

# iOS runs no program of an app's own: the supervisor is a framework there, k7supervisor.framework, which
# the app embeds and calls on a thread of its own; the linker folds every archive above into it (engine/k7-runtime/docs/ios.md).
if(IOS)
    add_library(k7-supervisor-embedded SHARED src/Embedded.cpp)
    target_link_libraries(k7-supervisor-embedded PRIVATE k7_supervisor_core)
    set_target_properties(k7-supervisor-embedded PROPERTIES
        FRAMEWORK TRUE
        OUTPUT_NAME k7supervisor
        MACOSX_FRAMEWORK_IDENTIFIER se.frediver.k7.supervisor
        LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
endif()

# --- tests: the engine's tiny harness, one binary, no device and no network -----------------------
enable_testing()
add_executable(k7_supervisor_tests
    tests/main_test.cpp
    tests/Url_test.cpp
    tests/Settings_test.cpp
    tests/HostProtocol_test.cpp
    tests/AudioPolicy_test.cpp
    tests/Performance_test.cpp
    tests/MachineJobs_test.cpp
    tests/RtcFrames_test.cpp
    tests/SeparationAudio_test.cpp
    tests/HostLock_test.cpp
    tests/Registry_test.cpp
    tests/Tls_test.cpp
    tests/Instruments_test.cpp
    tests/PathMap_test.cpp
    tests/PidFile_test.cpp
    tests/JobSlots_test.cpp
    tests/Log_test.cpp
    tests/Backpressure_test.cpp
    tests/Http_test.cpp
    tests/CrashLoop_test.cpp)
target_include_directories(k7_supervisor_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../k7-runtime/tests)
target_link_libraries(k7_supervisor_tests PRIVATE k7_supervisor_core)
k7_beside_runtime(k7_supervisor_tests)
add_test(NAME k7_supervisor_tests COMMAND k7_supervisor_tests)

# The agent alone, for packages/engine-tunnel's suites to run against the real TypeScript hub.
add_executable(tunnel_harness tests/tunnel_harness.cpp)
target_link_libraries(tunnel_harness PRIVATE k7_supervisor_core)
k7_beside_runtime(tunnel_harness)
