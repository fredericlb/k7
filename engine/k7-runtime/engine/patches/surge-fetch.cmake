# surge-fetch.cmake — fetches Surge XT at one commit, without its 480 MB of presets, and only the submodules its core builds from.
# The one thing a reader would get wrong: FetchContent's own git step cannot do this, since GIT_SHALLOW refuses a commit hash (docs/surgePlugin.md).
#
# Run as the DOWNLOAD_COMMAND: -DSRC=<source dir> -DCOMMIT=<sha> -DSUBMODULES=<comma list>. Idempotent: a stamp names what is there.

find_package(Git REQUIRED)
# Commas, because a `;` list does not survive ExternalProject's command line.
string(REPLACE "," ";" SUBMODULES "${SUBMODULES}")

set(_stamp "${SRC}/.studio-fetched")
set(_want "${COMMIT} ${SUBMODULES}")
if(EXISTS "${_stamp}")
    file(READ "${_stamp}" _have)
    if(_have STREQUAL _want)
        return()
    endif()
endif()

function(_git)
    execute_process(COMMAND "${GIT_EXECUTABLE}" ${ARGN} WORKING_DIRECTORY "${SRC}" RESULT_VARIABLE rc)
    if(NOT rc EQUAL 0)
        message(FATAL_ERROR "surge-fetch: git ${ARGN} failed (${rc})")
    endif()
endfunction()

file(REMOVE_RECURSE "${SRC}")
file(MAKE_DIRECTORY "${SRC}")
_git(init -q)
_git(remote add origin https://github.com/surge-synthesizer/surge.git)
# Everything but the factory content: resources/data is presets, wavetables and skins, which the engine never reads.
_git(sparse-checkout set --no-cone /* !/resources/data/)
_git(fetch -q --depth 1 origin ${COMMIT})
_git(checkout -q FETCH_HEAD)
foreach(_m IN LISTS SUBMODULES)
    _git(submodule update -q --init --depth 1 ${_m})
endforeach()

file(WRITE "${_stamp}" "${_want}")
