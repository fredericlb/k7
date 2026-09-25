// EngineProcess.cpp — see EngineProcess.h. The engine's output is piped into the merged log under
// `[engine]`, never into a file of its own: the Logs panel reads the merged log and nothing else.

#include "EngineProcess.h"

#include "HostProtocol.h"
#include "Log.h"
#include "Paths.h"
#include "Process.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace st0::engine {

namespace fs = std::filesystem;

namespace {

int readPid()
{
    std::ifstream in(paths::enginePid());
    int pid = 0;
    if (!(in >> pid)) return 0;
    return pid;
}

const std::vector<std::string> kNames = {"st0-engine.exe", "st0-engine"};

/** The checkout this executable was built in, found by walking up to `engine/st0-engine`. */
std::optional<fs::path> repoRoot()
{
    const auto exe = process::executablePath();
    if (exe.empty()) return std::nullopt;
    for (fs::path dir = exe.parent_path(); !dir.empty(); dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::is_directory(dir / "engine" / "st0-engine", ec)) return dir;
        if (dir == dir.parent_path()) break;
    }
    return std::nullopt;
}

}  // namespace

std::optional<fs::path> findBinary()
{
    std::error_code ec;
    if (const char* override = std::getenv("STUDIO_ENGINE"); override && *override && fs::exists(override, ec))
        return fs::path(override);
    if (const auto exe = process::executablePath(); !exe.empty())
        for (const auto& name : kNames)
            if (fs::is_regular_file(exe.parent_path() / name, ec)) return exe.parent_path() / name;

    const auto root = repoRoot();
    if (!root) return std::nullopt;
    const fs::path build = *root / "engine" / "st0-engine" / "build";
    if (!fs::is_directory(build, ec)) return std::nullopt;
    struct Found {
        fs::path path;
        bool debug;
        fs::file_time_type at;
    };
    std::vector<Found> found;
    for (const auto& preset : fs::directory_iterator(build, ec))
        for (const char* cfg : {"", "Release", "RelWithDebInfo", "Debug"})
            for (const auto& name : kNames) {
                const fs::path p = preset.path() / cfg / name;
                if (fs::is_regular_file(p, ec)) found.push_back({p, std::string(cfg) == "Debug", fs::last_write_time(p, ec)});
            }
    if (found.empty()) return std::nullopt;
    // Newest first WITHIN a tier, Debug a tier of its own below every other: at -O0 the DSP cannot keep up.
    std::sort(found.begin(), found.end(), [](const Found& a, const Found& b) {
        return a.debug != b.debug ? !a.debug : a.at > b.at;
    });
    return found.front().path;
}

bool running()
{
    const int pid = readPid();
    return pid > 0 && process::pidAlive(pid);
}

bool isServing(int port)
{
#ifdef _WIN32
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);
#else
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return false;
    fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK);
#endif
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<unsigned short>(port));
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr);
    fd_set w, e;
    FD_ZERO(&w);
    FD_ZERO(&e);
    FD_SET(s, &w);
    FD_SET(s, &e);
    timeval tv{0, 300 * 1000};
    bool up = false;
    if (select(static_cast<int>(s) + 1, nullptr, &w, &e, &tv) > 0 && FD_ISSET(s, &w)) {
        int err = 0;
        socklen_t len = sizeof err;
        getsockopt(s, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&err), &len);
        up = err == 0;
    }
#ifdef _WIN32
    closesocket(s);
#else
    close(s);
#endif
    return up;
}

#ifdef __ANDROID__
namespace {
// How long the app gets to bind the engine's port: JUCE and the audio device come up first.
constexpr auto kAppStartBound = std::chrono::seconds(20);
}  // namespace

StartResult start(const EngineIdentity& identity, int port)
{
    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    // The engine lives in the process that spawned us, so the pidfile names our parent.
    const int app = static_cast<int>(getppid());
    if (isServing(port)) {
        std::ofstream(paths::enginePid(), std::ios::trunc) << app;
        log::host("adopting the engine the app already serves on :" + std::to_string(port));
        return {StartKind::Adopted, app};
    }
    protocol::emit({{"t", "engine"}, {"action", "start"}, {"id", identity.id}, {"token", identity.token},
                    {"port", port}, {"host", "0.0.0.0"}});
    const auto until = std::chrono::steady_clock::now() + kAppStartBound;
    while (!isServing(port)) {
        if (std::chrono::steady_clock::now() > until)
            return {StartKind::Error, 0, "the app did not start the engine on :" + std::to_string(port)};
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    std::ofstream(paths::enginePid(), std::ios::trunc) << app;
    log::host("the app started the engine on :" + std::to_string(port));
    return {StartKind::Spawned, app};
}

void stop()
{
    // Never a kill: the pid is the app's own, and the engine is a thread of it.
    protocol::emit({{"t", "engine"}, {"action", "stop"}});
    std::error_code ec;
    fs::remove(paths::enginePid(), ec);
}
#else
StartResult start(const EngineIdentity& identity, int port)
{
    if (running()) {
        // A pid is not an identity, so the PORT is asked too — here, where a wrong answer costs a spare engine.
        if (isServing(port)) {
            log::host("adopting the engine already on the pidfile");
            return {StartKind::Adopted};
        }
        log::host("pidfile names a live process but nothing answers :" + std::to_string(port) +
                  " — stale, starting a fresh engine");
        std::error_code ec;
        fs::remove(paths::enginePid(), ec);
    }
    const auto bin = findBinary();
    if (!bin) return {StartKind::Missing};

    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    process::SpawnOptions opts;
    opts.program = *bin;
    opts.args = {std::to_string(port)};
    // Reachable on the LAN for a browser on another machine; loopback works as well.
    opts.env = {{"STUDIO_ENGINE_HOST", "0.0.0.0"}, {"STUDIO_ENGINE_ID", identity.id}, {"STUDIO_ENGINE_TOKEN", identity.token}};
    opts.onLine = [](const std::string& line, bool) { log::line("engine", line); };
    const auto spawned = process::spawn(opts);
    if (!spawned.pid) return {StartKind::Error, 0, spawned.error};
    std::ofstream(paths::enginePid(), std::ios::trunc) << spawned.pid;
    log::host("engine started (pid " + std::to_string(spawned.pid) + ") on :" + std::to_string(port));
    return {StartKind::Spawned, spawned.pid};
}

void stop()
{
    // The whole TREE, not the pid: a scan child left behind keeps the audio device and the port.
    if (const int pid = readPid(); pid > 0) process::killTree(pid);
    std::error_code ec;
    fs::remove(paths::enginePid(), ec);
}
#endif

}  // namespace st0::engine
