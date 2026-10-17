// EngineEmbed.h — the iOS app's two doors into the engine, the counterpart of android/EngineJni.cpp:
// serve on a port, and stop serving. k7_engine_serve BLOCKS, and the thread that calls it becomes
// JUCE's message thread, so no other thread may touch JUCE before it (docs/ios.md).

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/** Serve on `port` until k7_engine_quit(); returns serve()'s exit code. Once per process. */
int k7_engine_serve(int port);

/** Ask a running k7_engine_serve to return; safe from any thread. */
void k7_engine_quit(void);

/** Close the audio device (non-zero) or reopen it (zero), so iOS may suspend an app idle in the background; any thread. */
void k7_engine_suspend_audio(int suspended);

#ifdef __cplusplus
}
#endif
