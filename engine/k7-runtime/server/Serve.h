// Serve.h — the engine's WebSocket server: bind, play, answer, until asked to quit. main() runs it once
// its CLI modes have declined; on Android the JNI entry runs it on the thread whose Looper is JUCE's
// message loop, which is why it BLOCKS rather than returning a handle. See docs/android.md.

#pragma once

namespace studio {

/** Serve on `port` until requestQuit(); returns the process exit code. Blocks on the message loop. */
int serve(int port);

/** Ask a running serve() to return — from a signal handler or any thread; a no-op when none runs. */
void requestQuit();

}  // namespace studio
