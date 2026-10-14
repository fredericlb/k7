# stmlib.cmake — the fixes stmlib needs, applied at fetch time (PATCH_COMMAND), like eurorack.cmake.

include("${CMAKE_CURRENT_LIST_DIR}/studio_replace.cmake")

# utils/dsp.h — included by braids, peaks and plaits' waveshaping engine — declares each helper with
# GCC's __attribute__((always_inline)). MSVC does not know __attribute__: it misreads every
# declaration, then rejects each definition as a second body, and the Windows build stops. The
# attribute is only an inlining hint on tiny inline functions, so it goes, on every platform.
# Not a blanket `#define __attribute__(x)` for the target: that strips system headers' too.
studio_replace("utils/dsp.h" "\n  __attribute__((always_inline));" ";  // studio: always_inline stripped, for MSVC")
