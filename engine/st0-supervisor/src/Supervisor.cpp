// Supervisor.cpp — see Supervisor.h. Every member of Impl is touched on the loop thread only; work
// that blocks goes through `loop.work` and comes back as a posted task.

#include "Supervisor.h"

#include "HostLock.h"
#include "Log.h"
#include "Paths.h"

#include <stdexcept>

namespace st0 {

struct Supervisor::Impl {
    Loop& loop;
    std::function<void()> exit;
    EngineIdentity identity;
    Settings settings;
    protocol::Snapshot snap;
    std::string lastFrame;
    bool shuttingDown = false;
    std::uint64_t lockTimer = 0;

    Impl(Loop& l, std::function<void()> e) : loop(l), exit(std::move(e)) {}

    void publish()
    {
        snap.engineId = identity.id;
        snap.enginePort = settings.port;
        snap.audioPriority = settings.audioPriority;
        snap.rootPath = paths::utf8(paths::rootDir());
        snap.mergedLogPath = paths::utf8(paths::mergedLog());
        const auto frame = protocol::stateFrame(snap);
        const std::string bytes = frame.dump();
        // Nothing the tray draws has moved.
        if (bytes == lastFrame) return;
        lastFrame = bytes;
        protocol::emit(frame);
    }

    void reply(int id, bool ok, const std::string& message = "") { protocol::emit(protocol::resultFrame(id, ok, message)); }
};

Supervisor::Supervisor(Loop& loop, std::function<void()> exit) : impl_(std::make_unique<Impl>(loop, std::move(exit))) {}

Supervisor::~Supervisor() = default;

void Supervisor::start()
{
    auto& s = *impl_;
    // Before anything is spawned or adopted: a second supervisor would adopt the FIRST one's engine.
    if (int holder = hostlock::acquire())
        throw std::runtime_error("an engine supervisor is already running (pid " + std::to_string(holder) +
                                 ") — quit it first");
    s.lockTimer = s.loop.every(Loop::Ms(hostlock::kRefreshMs), [] { hostlock::refresh(); });
    s.settings = loadSettings();
    s.identity = ensureEngineIdentity();
    // The first snapshot: the tray draws nothing until it arrives.
    s.publish();
    log::host("supervisor started (native)");
}

void Supervisor::onCommand(const protocol::Command& cmd)
{
    auto& s = *impl_;
    if (cmd.cmd == "shutdown") {
        shutdown();
        return;
    }
    // A command for a subsystem not owned yet — answering keeps a mis-staged tray debuggable rather than inert.
    s.reply(cmd.id, false, cmd.cmd + " is not owned by the supervisor yet");
}

void Supervisor::shutdown()
{
    auto& s = *impl_;
    if (s.shuttingDown) return;
    s.shuttingDown = true;
    s.loop.cancel(s.lockTimer);
    hostlock::release();
    s.exit();
}

}  // namespace st0
