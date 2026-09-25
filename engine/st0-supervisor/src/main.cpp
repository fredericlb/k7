// main.cpp — the supervisor's entry point. Spawned BY the tray and driven over NDJSON on stdio: reads
// what it needs from `~/.st0`, and has no standalone mode — a supervisor outliving the tray would be
// a ghost engine. Stdin ending IS the tray going away, and that ends us too. The one argument it
// takes is `--probe <address>`: ask a studio's registry, print the answer, touch nothing.

#include "HostProtocol.h"
#include "Log.h"
#include "Loop.h"
#include "Registry.h"
#include "Supervisor.h"
#include "Url.h"

#include <csignal>
#include <cstdio>
#include <exception>
#include <iostream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

st0::Loop* gLoop = nullptr;
st0::Supervisor* gSupervisor = nullptr;

extern "C" void onSignal(int)
{
    // A handler may do almost nothing; posting is a lock and a push, run from the loop afterwards.
    if (gLoop && gSupervisor) gLoop->post([] { gSupervisor->shutdown(); });
}

}  // namespace

int main(int argc, char** argv)
{
    if (argc == 3 && std::string(argv[1]) == "--probe") {
        const auto origin = st0::url::normaliseUserOrigin(argv[2]);
        if (!origin) {
            std::printf("%s is not a web address\n", argv[2]);
            return 2;
        }
        const auto reg = st0::url::engineRegistryUrl(*origin);
        const auto p = st0::registry::probe(reg);
        std::printf("%s: %s\n", reg.c_str(), p.ok ? "an st0 registry" : p.why.c_str());
        return p.ok ? 0 : 1;
    }
#ifdef _WIN32
    // Binary stdio, so a frame's `\n` is not turned into `\r\n` and a UTF-8 byte is never translated.
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
#endif
    st0::Loop loop;
    int code = 0;
    st0::Supervisor supervisor(loop, [&] { loop.stop(); });
    gLoop = &loop;
    gSupervisor = &supervisor;
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
#ifdef SIGHUP
    std::signal(SIGHUP, onSignal);
#endif

    try {
        supervisor.start();
    } catch (const std::exception& e) {
        // Nothing above us will report this — the tray sees only a process that exited — so say why.
        st0::log::stderrOnly(std::string("[host] fatal: ") + e.what());
        return 1;
    }

    // The tray's commands, one per line, until stdin closes — on Unix that END is the whole teardown.
    std::thread([&loop, &supervisor] {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (auto cmd = st0::protocol::parseCommand(line))
                loop.post([&supervisor, c = *cmd] { supervisor.onCommand(c); });
        }
        loop.post([&supervisor] { supervisor.shutdown(); });
    }).detach();

    loop.run();
    std::fflush(stdout);
    // The stdin thread may still be blocked in a read; exiting here is what ends it.
    std::_Exit(code);
}
