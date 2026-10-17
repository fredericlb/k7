// Embedded.h — the supervisor as a library, for the iOS app, which may run no program of its own: the
// C entry its Swift half calls. What the app writes to `commandsFd` and reads from `framesFd` is the
// NDJSON a desktop app exchanges with the program over stdio (engine/k7-runtime/docs/ios.md).

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/** Run until the app closes the write end of `commandsFd` (its quit) or the supervisor exits; blocks the calling thread. */
int k7_supervisor_run(int commandsFd, int framesFd);

#ifdef __cplusplus
}
#endif
