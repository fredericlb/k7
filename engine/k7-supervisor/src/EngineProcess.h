// EngineProcess.h — find, start, adopt and stop the C++ engine. One engine per machine, with
// `<state>/engine.pid` as the guard: that pidfile is what makes a supervisor crash survivable, the
// engine outliving us and the next supervisor ADOPTING it. A pid is not an identity, so adopting
// also asks the PORT. On Android the engine is a library in the app that spawned us, so starting and
// stopping it are REQUESTS to that app over stdout (engine/k7-runtime/docs/android.md). See docs/supervisor.md.

#pragma once

#include "Identity.h"

#include <filesystem>
#include <optional>
#include <string>

namespace k7::engine {

/** `$STUDIO_ENGINE`, the copy beside this executable (a packaged app), then the repo's newest build, Debug last. */
std::optional<std::filesystem::path> findBinary();

/** Is an engine up — the pidfile names a live process. */
bool running();

/** Is something serving on this loopback port? Never "is it OURS". Blocks for at most ~300 ms. */
bool isServing(int port);

enum class StartKind { Spawned, Adopted, Missing, Error };

struct StartResult {
    StartKind kind;
    int pid = 0;
    std::string message;
};

/** Bring an engine up, or adopt the one already serving; blocking, so call it off the loop. */
StartResult start(const EngineIdentity& identity, int port);

/** Stop the engine the pidfile names, its whole process tree, and clear the pidfile. */
void stop();

}  // namespace k7::engine
