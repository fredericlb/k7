# A standalone spike: Strudel evaluated inside QuickJS, compared against Node. Not part of the engine build.
# Why it stands alone, and what it measured: README.md.
cmake_minimum_required(VERSION 3.24)
project(StrudelQuickJsSpike LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

FetchContent_Declare(quickjs
    GIT_REPOSITORY https://github.com/quickjs-ng/quickjs.git
    GIT_TAG        v0.17.0
    GIT_SHALLOW    ON)
# The library only: the qjs/qjsc executables and quickjs-libc are what an embedder does not ship.
set(QJS_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(QJS_BUILD_CLI_WITH_MIMALLOC OFF CACHE BOOL "" FORCE)

# The engine's own pin, so the comparison reads JSON the way the engine would.
FetchContent_Declare(nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    ON)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(quickjs nlohmann_json)

add_executable(strudel_qjs src/StrudelHost.cpp src/main.cpp)
target_link_libraries(strudel_qjs PRIVATE qjs nlohmann_json::nlohmann_json)
