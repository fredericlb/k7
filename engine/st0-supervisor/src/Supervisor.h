// Supervisor.h — the engine machine's supervisor proper: owns the `~/.st0` contract, keeps the
// engine up, the registry entry and the tunnels live, and answers the tray's commands. One state,
// mutated only on the Loop's thread, and a snapshot emitted only when its bytes changed — which is
// what keeps an idle app quiet on the wire. See docs/supervisor.md.

#pragma once

#include "HostProtocol.h"
#include "Identity.h"
#include "Loop.h"
#include "Settings.h"

#include <functional>
#include <memory>
#include <string>

namespace st0 {

class Supervisor {
public:
    /** `exit` ends things once the teardown is done; the default ends the process. */
    Supervisor(Loop& loop, std::function<void()> exit);
    ~Supervisor();

    /** Take the lock and start every loop; throws when another supervisor holds the lock. */
    void start();

    /** A command off the tray's channel. */
    void onCommand(const protocol::Command& cmd);

    /** Tear down: deregister (bounded), stop the engine, release the lock, then `exit`. Idempotent. */
    void shutdown();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace st0
