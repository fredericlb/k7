# eurorack.cmake — the fixes the firmware sources need, applied at fetch time (PATCH_COMMAND).
# A CMake script rather than a .patch, so no `patch` binary is needed on any of the three desktops.
# Each one fails LOUDLY when its text is not found: a bump that moved the code must be looked at.

include("${CMAKE_CURRENT_LIST_DIR}/studio_replace.cmake")

# Clouds' stretch mode: Window::Start never clears done_, so no window ever plays and the mode is
# silent. VCV Rack's fork of this code carries the same one-line fix.
studio_replace("clouds/dsp/window.h"
    "    phase_ = 0;\n    regenerated_ = false;"
    "    phase_ = 0;\n    done_ = false;\n    regenerated_ = false;")
