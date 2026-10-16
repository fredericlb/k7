// main.cpp — the supervisor's entry point, run two ways. Spawned by an app (the desktop app, the phone) and driven over
// NDJSON on stdio, where stdin ending IS the app going away and ends us too. Or `--config <file>`, the command-line
// engine: settings from that file, no frames on stdout, running until SIGINT or SIGTERM. Two diagnostics take
// arguments and touch nothing else: `--probe <address>` asks a studio's registry, and
// `--separate <mix> <model> <outDir> [providers]` runs one stem separation here, printing progress.

#include "Crash.h"
#include "HostProtocol.h"
#include "Log.h"
#include "Loop.h"
#include "Processes.h"
#include "Registry.h"
#include "Separation.h"
#include "Settings.h"
#include "Supervisor.h"
#include "Tls.h"
#include "Url.h"

#include <ixwebsocket/IXNetSystem.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

namespace {

// Set by the signal handler and read by a timer on the loop: a lock-free store is all a handler may safely do.
std::atomic<bool> gSignalled{false};
static_assert(std::atomic<bool>::is_always_lock_free);

// How often the loop looks at that flag; a quit within this is soon enough for Ctrl-C.
constexpr std::chrono::milliseconds kSignalPoll{100};

extern "C" void onSignal(int)
{
    gSignalled.store(true, std::memory_order_relaxed);
}

/** `--config <file>`: read it, put its environment keys in place, and make it the settings; false with a message on failure. */
bool useConfig(const char* file)
{
    std::ifstream in(file, std::ios::binary);
    if (!in) {
        std::fprintf(stderr, "cannot read %s\n", file);
        return false;
    }
    std::stringstream buf;
    buf << in.rdbuf();
    const auto raw = nlohmann::json::parse(buf.str(), nullptr, false);
    if (raw.is_discarded() || !raw.is_object()) {
        std::fprintf(stderr, "%s is not a JSON object\n", file);
        return false;
    }
    for (const auto& [var, value] : k7::configEnvironment(raw)) {
#ifdef _WIN32
        _putenv_s(var.c_str(), value.c_str());
#else
        setenv(var.c_str(), value.c_str(), 1);
#endif
    }
    k7::useConfigFile(file);
    k7::protocol::silenceFrames();
    k7::log::standalone();
    return true;
}

}  // namespace

int main(int argc, char** argv)
{
    // Winsock first, before ANY socket — `--probe` below speaks HTTP too. IXWebSocket leaves it to the
    // program, as the engine's Serve.cpp does. Without it every socket on Windows fails WSANOTINITIALISED,
    // and nothing says so: no engine query is answered (an app shows every interface "not connected"),
    // and isServing() never sees the engine, so one is never adopted. A no-op elsewhere; no teardown, since
    // we leave by _Exit.
    ix::initNetSystem();
    // Before any thread starts: a crash must say why in the log and leave a dump (Crash.h).
    k7::crash::install();
    // mbedtls's mutexes and its global generator, set up HERE while there is one thread: every TLS socket draws from it, and the registry opens one per studio at once (docs/supervisor.md).
    k7::tls::init();

    if (argc == 3 && std::string(argv[1]) == "--probe") {
        const auto origin = k7::url::normaliseUserOrigin(argv[2]);
        if (!origin) {
            std::printf("%s is not a web address\n", argv[2]);
            return 2;
        }
        const auto reg = k7::url::engineRegistryUrl(*origin);
        const auto p = k7::registry::probe(reg);
        std::printf("%s: %s\n", reg.c_str(), p.ok ? "an k7 registry" : p.why.c_str());
        return p.ok ? 0 : 1;
    }
    if ((argc == 5 || argc == 6) && std::string(argv[1]) == "--separate") {
        k7::separation::Request r;
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
        k7::separation::run(r, [&](const nlohmann::json& job) {
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
    // Driven by an app over stdio unless a config file says otherwise.
    const bool headless = argc == 3 && std::string(argv[1]) == "--config";
    if (headless && !useConfig(argv[2])) return 2;
    if (!headless && argc > 1) {
        std::fprintf(stderr,
                     "usage: k7-supervisor --config <file>\n"
                     "       k7-supervisor --probe <address>\n"
                     "       k7-supervisor --separate <mix> <model> <outDir> [providers]\n"
                     "       k7-supervisor            (driven by an app over stdio)\n");
        return 2;
    }
#ifdef _WIN32
    // Binary stdio, so a frame's `\n` is not turned into `\r\n` and a UTF-8 byte is never translated.
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    // Never into a spawned child: a copy of the app's pipe outliving us costs the app our EOF (docs/supervisor.md).
    for (const DWORD id : {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE})
        SetHandleInformation(GetStdHandle(id), HANDLE_FLAG_INHERIT, 0);
#endif
    // Before the engine is spawned, so it is born inside the job (docs/supervisor.md).
    if (const auto why = k7::process::joinHostJob(); !why.empty()) k7::log::stderrOnly("[host] no kill-on-close job: " + why);
    k7::Loop loop;
    int code = 0;
    k7::Supervisor supervisor(loop, [&] { loop.stop(); });
    loop.every(kSignalPoll, [&supervisor] {
        if (gSignalled.exchange(false, std::memory_order_relaxed)) supervisor.shutdown();
    });
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
#ifdef SIGHUP
    std::signal(SIGHUP, onSignal);
#endif

    try {
        supervisor.start();
    } catch (const std::exception& e) {
        // Nothing above us will report this — an app sees only a process that exited — so say why.
        k7::log::stderrOnly(std::string("[host] fatal: ") + e.what());
        return 1;
    }

    if (headless) k7::log::stderrOnly("[host] running from the config file; Ctrl-C to stop");
    // The app's commands, one per line, until stdin closes — on Unix that END is the whole teardown.
    if (!headless) std::thread([&loop, &supervisor] {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (auto cmd = k7::protocol::parseCommand(line))
                loop.post([&supervisor, c = *cmd] { supervisor.onCommand(c); });
        }
        loop.post([&supervisor] { supervisor.shutdown(); });
    }).detach();

    loop.run();
    std::fflush(stdout);
    // The stdin thread may still be blocked in a read; exiting here is what ends it.
    std::_Exit(code);
}
