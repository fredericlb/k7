# surge-fetch.cmake — fetches Surge XT at one commit, without its 480 MB of presets, and only the submodules its core builds from.
# The one thing a reader would get wrong: FetchContent's own git step cannot do this, since GIT_SHALLOW refuses a commit hash (docs/surgePlugin.md).
#
# Run as the DOWNLOAD_COMMAND: -DSRC=<source dir> -DCOMMIT=<sha> -DSUBMODULES=<comma list>. Idempotent: a stamp names what is there.
# It leaves no .git behind: a cloned tree's history is most of its size, and the tree is what CI caches.

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

# What cmake/versiontools.cmake would ask git, in the file it reads first, so the history can go: CI caches this tree (docs/build.md).
execute_process(COMMAND "${GIT_EXECUTABLE}" rev-parse --abbrev-ref HEAD WORKING_DIRECTORY "${SRC}" OUTPUT_VARIABLE _branch OUTPUT_STRIP_TRAILING_WHITESPACE)
execute_process(COMMAND "${GIT_EXECUTABLE}" rev-parse --short HEAD WORKING_DIRECTORY "${SRC}" OUTPUT_VARIABLE _hash OUTPUT_STRIP_TRAILING_WHITESPACE)
file(WRITE "${SRC}/VERSION_GIT_INFO" "studio\n${_branch}\n${_hash}\n")
foreach(_m IN LISTS SUBMODULES)
    file(REMOVE_RECURSE "${SRC}/${_m}/.git")
endforeach()
file(REMOVE_RECURSE "${SRC}/.git")

file(WRITE "${_stamp}" "${_want}")
