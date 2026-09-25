// EngineJni.cpp — the Android app's two doors into the engine: serve on a port, and stop serving.
// nativeServe BLOCKS, and must be called on a thread that has PREPARED a Looper and loops nothing yet —
// not a HandlerThread, which already is inside loop() — because the first JUCE call on it makes it JUCE's
// message thread, and EngineHost::run loops that Looper. Java.initialiseJUCE must have run first.
// See docs/android.md.

#include "../Serve.h"

#include <android/log.h>
#include <jni.h>
#include <unistd.h>

#include <cstdio>
#include <string>
#include <thread>

namespace {

// Everything the engine says goes to stderr, which Android discards: pipe it into logcat, a line per entry.
void stderrToLogcat() {
    static bool started = false;
    if (started) return;
    int fds[2];
    if (pipe(fds) != 0) return;
    started = true;
    setvbuf(stderr, nullptr, _IOLBF, 0);
    dup2(fds[1], STDERR_FILENO);
    close(fds[1]);
    std::thread([fd = fds[0]] {
        std::string line;
        char buf[512];
        for (ssize_t n; (n = read(fd, buf, sizeof buf)) > 0;) {
            for (ssize_t i = 0; i < n; ++i) {
                if (buf[i] != '\n') { line += buf[i]; continue; }
                __android_log_write(ANDROID_LOG_INFO, "st0-engine", line.c_str());
                line.clear();
            }
        }
    }).detach();
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_se_frediver_st0_EngineBridge_nativeServe(JNIEnv*, jclass, jint port) {
    stderrToLogcat();
    return studio::serve(static_cast<int>(port));
}

extern "C" JNIEXPORT void JNICALL
Java_se_frediver_st0_EngineBridge_nativeQuit(JNIEnv*, jclass) {
    studio::requestQuit();
}
