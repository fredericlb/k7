// EngineEmbed.cpp — see EngineEmbed.h. Nothing iOS-specific happens here: the message loop is
// EngineHost::run's, and the app pipes the process's stderr into the system log (docs/ios.md).

#include "EngineEmbed.h"

#include "../Serve.h"

extern "C" int k7_engine_serve(int port) {
    return studio::serve(port);
}

extern "C" void k7_engine_quit(void) {
    studio::requestQuit();
}

extern "C" void k7_engine_suspend_audio(int suspended) {
    studio::suspendAudio(suspended != 0);
}
