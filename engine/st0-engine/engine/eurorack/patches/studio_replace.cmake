# studio_replace.cmake — the one edit the fetch-time patch scripts make, shared by eurorack.cmake and
# stmlib.cmake. It fails LOUDLY when its text is not found: a bump that moved the code must be looked at.

function(studio_replace file from to)
    file(READ "${file}" text)
    string(FIND "${text}" "${from}" at)
    if(at EQUAL -1)
        message(FATAL_ERROR "eurorack patch: text not found in ${file} — was the source bumped?")
    endif()
    string(REPLACE "${from}" "${to}" text "${text}")
    file(WRITE "${file}" "${text}")
endfunction()
