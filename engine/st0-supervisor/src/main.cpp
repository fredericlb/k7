// main.cpp — the supervisor's entry point. Spawned BY the tray and driven over NDJSON on stdio: reads
// what it needs from `~/.st0`, and has no standalone mode — a supervisor outliving the tray would be
// a ghost engine. Stdin ending IS the tray going away, and that ends us too. Two diagnostics take
// arguments and touch nothing else: `--probe <address>` asks a studio's registry, and
// `--separate <mix> <model> <outDir> [providers]` runs one stem separation here, printing progress.

#include "Crash.h"
#include "HostProtocol.h"
#include "Log.h"
#include "Loop.h"
#include "Registry.h"
#include "Separation.h"
#include "Supervisor.h"
#include "Tls.h"
#include "Url.h"

#include <ixwebsocket/IXNetSystem.h>

#include <csignal>
#include <cstdio>
#include <exception>
#include <iostream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
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
    // Winsock first, before ANY socket — `--probe` below speaks HTTP too. IXWebSocket leaves it to the
    // program, as the engine's Serve.cpp does. Without it every socket on Windows fails WSANOTINITIALISED,
    // and nothing says so: no engine query is answered (the tray showed every interface "not connected"),
    // and isServing() never sees the engine, so one is never adopted. A no-op elsewhere; no teardown, since
    // we leave by _Exit.
    ix::initNetSystem();
    // Before any thread starts: a crash must say why in the log and leave a dump (Crash.h).
    st0::crash::install();
    // mbedtls's mutexes and its global generator, set up HERE while there is one thread: every TLS socket draws from it, and the registry opens one per studio at once (docs/supervisor.md).
    st0::tls::init();

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
    if ((argc == 5 || argc == 6) && std::string(argv[1]) == "--separate") {
        st0::separation::Request r;
        r.source = argv[2];
        r.model = argv[3];
        r.outDir = argv[4];
        if (argc == 6) {
            std::string list(argv[5]);
            for (size_t start = 0; start <= list.size();) {
                const size_t comma = list.find(',', start);
                r.providers.push_back(list.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
                if (comma == std::string::npos) break;
                start = comma + 1;
            }
        }
        bool failed = false;
        st0::separation::run(r, [&](const nlohmann::json& job) {
            std::printf("%s %s\n", job.value("phase", "").c_str(),
                        job["percent"].is_null() ? "" : std::to_string(job["percent"].get<int>()).append("%").c_str());
            if (job.value("done", false)) {
                for (const auto& l : job["lines"]) std::printf("  %s\n", l.get<std::string>().c_str());
                for (const auto& f : job["files"]) std::printf("  → %s\n", f.get<std::string>().c_str());
                if (job.value("failed", false)) std::printf("failed: %s\n", job.value("error", "").c_str());
                failed = job.value("failed", false);
            }
            std::fflush(stdout);
        });
        return failed ? 1 : 0;
    }
#ifdef _WIN32
    // Binary stdio, so a frame's `\n` is not turned into `\r\n` and a UTF-8 byte is never translated.
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    // Never into a spawned child: a copy of the tray's pipe outliving us costs the tray our EOF (docs/supervisor.md).
    for (const DWORD id : {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE})
        SetHandleInformation(GetStdHandle(id), HANDLE_FLAG_INHERIT, 0);
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
