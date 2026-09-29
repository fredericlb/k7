# faust.cmake — the fix Faust's poly-dsp.h needs, applied at fetch time (PATCH_COMMAND), like the eurorack scripts.
# The one thing a reader would get wrong: these prints are not debug-only upstream, they run on EVERY voice steal.

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# keyOn/keyOff run on the audio thread, and each print takes the FILE lock and a write(2) — a stall, or a hang on an undrained pipe (docs/faust.md).
set(poly "architecture/faust/dsp/poly-dsp.h")
studio_replace("${poly}" "fprintf(stderr, \"Steal release voice" "if (false) fprintf (stderr, \"Steal release voice")
studio_replace("${poly}" "fprintf(stderr, \"Steal playing voice" "if (false) fprintf (stderr, \"Steal playing voice")
studio_replace("${poly}" "fprintf(stderr, \"DSP is not polyphonic" "if (false) fprintf (stderr, \"DSP is not polyphonic")
studio_replace("${poly}" "fprintf(stderr, \"Playing pitch = %d not found" "if (false) fprintf (stderr, \"Playing pitch = %d not found")
