# studio_replace.cmake — the one edit the fetch-time patch scripts make, shared by eurorack.cmake and
# stmlib.cmake. It fails LOUDLY when its text is not found: a bump that moved the code must be looked at.
#
# And it is a no-op when the edit is already there. The patch step runs AGAIN on a source it has
# already patched whenever its command changes, and the command names this script by an absolute
# path — which, on CI, holds the build's own number (onedev-build-16-276-1). Every CI run re-patches
# the kept sources, so `to` must be recognisable: never a bare token that the file holds anyway.

function(studio_replace file from to)
    file(READ "${file}" text)
    string(FIND "${text}" "${from}" at)
    if(at EQUAL -1)
        string(FIND "${text}" "${to}" done)
        if(NOT done EQUAL -1)
            return()
        endif()
        message(FATAL_ERROR "eurorack patch: text not found in ${file} — was the source bumped?")
    endif()
    string(REPLACE "${from}" "${to}" text "${text}")
    file(WRITE "${file}" "${text}")
endfunction()
