# eurorack.cmake — the fixes the firmware sources need, applied at fetch time (PATCH_COMMAND).
# A CMake script rather than a .patch, so no `patch` binary is needed on any of the three desktops.
# Each one fails LOUDLY when its text is not found: a bump that moved the code must be looked at.

include("${CMAKE_CURRENT_LIST_DIR}/studio_replace.cmake")

# Clouds' stretch mode: Window::Start never clears done_, so no window ever plays and the mode is
# silent. VCV Rack's fork of this code carries the same one-line fix.
studio_replace("clouds/dsp/window.h"
    "    phase_ = 0;\n    regenerated_ = false;"
    "    phase_ = 0;\n    done_ = false;\n    regenerated_ = false;")

# The generated resources.cc files end with index tables that list nothing: `T* x[] = {\n};`. GCC
# takes a zero-length array; MSVC refuses it (C2466). Nothing reads them — resources.h only declares
# them — so each gets one null entry.
function(studio_fill_empty_table file decl)
    studio_replace("${file}" "${decl}[] = {\n};"
        "${decl}[] = {\n  nullptr,  // studio: MSVC refuses an empty array\n};")
endfunction()
studio_fill_empty_table("plaits/resources.cc" "const int32_t* const lookup_table_i32_table")
studio_fill_empty_table("rings/resources.cc" "const int16_t* lookup_table_int16_table")
studio_fill_empty_table("rings/resources.cc" "const uint32_t* lookup_table_uint32_table")
studio_fill_empty_table("elements/resources.cc" "const uint32_t* lookup_table_uint32_table")

# Plaits' flash mocks, compiled under TEST, call printf with no <cstdio>: Clang's headers bring it along,
# libstdc++'s do not, so GCC stops there.
studio_replace("plaits/user_data.h"
    "#include \"stmlib/stmlib.h\"\n\n#ifdef TEST"
    "#include \"stmlib/stmlib.h\"\n#include <cstdio>  // studio: printf under TEST, which GCC's headers do not bring\n\n#ifdef TEST")
