// Embedded.cpp — see Embedded.h. main.cpp's stdio mode on the caller's thread, over two pipes: the app's
// stdout is shared with node and the engine, so frames get a descriptor of their own. No signal or crash
// handler is installed, nor any exit taken: the process is the app's. One call at a time, and called
// again after a return for what only a start reads — the trusted CAs; each run's loop is left allocated.

#include "Embedded.h"

#include "HostProtocol.h"
#include "Log.h"
#include "Loop.h"
#include "Supervisor.h"
#include "Tls.h"
#include "TrustRoots.h"

#include <ixwebsocket/IXNetSystem.h>

#include <poll.h>
#include <unistd.h>

#include <cerrno>
#include <exception>
#include <mutex>
#include <string>
#include <thread>

namespace {

// Lines from `fd` until it ends or `wake` is written: the loop may stop on its own, and the app's pipe would never end then.
void readCommands(int fd, int wake, k7::Loop& loop, k7::Supervisor& supervisor)
{
    std::string pending;
    char buf[4096];
    for (;;) {
        pollfd fds[2] = {{fd, POLLIN, 0}, {wake, POLLIN, 0}};
        if (::poll(fds, 2, -1) < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (fds[1].revents) return;
        const ssize_t n = ::read(fd, buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        pending.append(buf, static_cast<size_t>(n));
        for (size_t nl; (nl = pending.find('\n')) != std::string::npos; pending.erase(0, nl + 1))
            if (auto cmd = k7::protocol::parseCommand(pending.substr(0, nl)))
                loop.post([&supervisor, c = *cmd] { supervisor.onCommand(c); });
    }
    loop.post([&supervisor] { supervisor.shutdown(); });
}

}  // namespace

extern "C" int k7_supervisor_run(int commandsFd, int framesFd)
{
    static std::once_flag once;
    // Process-wide, as main.cpp does them before any thread: Winsock's equivalent and mbedTLS's mutexes and generator.
    std::call_once(once, [] {
        ix::initNetSystem();
        k7::tls::init();
    });
    k7::tls::forgetRoots();
    k7::protocol::sendFramesTo(framesFd);
    int wake[2];
    if (::pipe(wake) != 0) return 1;
    int code = 0;
    // Never freed: a `work()` thread still running posts back to its loop, which main.cpp outlives by _Exit and a library cannot.
    auto* loop = new k7::Loop;
    auto* supervisor = new k7::Supervisor(*loop, [loop] { loop->stop(); });
    try {
        supervisor->start();
    } catch (const std::exception& e) {
        k7::log::stderrOnly(std::string("[host] fatal: ") + e.what());
        code = 1;
    }
    if (code == 0) {
        std::thread reader(readCommands, commandsFd, wake[0], std::ref(*loop), std::ref(*supervisor));
        loop->run();
        (void)::write(wake[1], "x", 1);
        reader.join();
    }
    ::close(wake[0]);
    ::close(wake[1]);
    k7::protocol::sendFramesTo(-1);
    return code;
}
