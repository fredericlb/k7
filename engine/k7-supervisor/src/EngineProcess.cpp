// EngineProcess.cpp — see EngineProcess.h. The engine's output is piped into the merged log under
// `[engine]`, never into a file of its own: the Logs panel reads the merged log and nothing else.

#include "EngineProcess.h"

#include "HostProtocol.h"
#include "Log.h"
#include "Paths.h"
#include "PidFile.h"
#include "Platform.h"
#include "Processes.h"
#include "Url.h"

#include <algorithm>
#include <cstdlib>
#include <chrono>
#include <fstream>
#include <mutex>
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

namespace k7::engine {

namespace fs = std::filesystem;

std::string allowedOrigins(const std::vector<std::string>& registryUrls)
{
    std::vector<std::string> seen;
    std::string out;
    for (const auto& r : registryUrls) {
        const auto u = url::parse(r);
        if (!u || (u->scheme != "http" && u->scheme != "https")) continue;
        const std::string o = u->origin();
        if (o.find(',') != std::string::npos || std::find(seen.begin(), seen.end(), o) != seen.end()) continue;
        seen.push_back(o);
        out += (out.empty() ? "" : ",") + o;
    }
    return out;
}

namespace {

#ifndef K7_ENGINE_IN_APP
/** The engine THIS supervisor spawned, and whether its reaper has seen it exit. */
std::mutex ownedMutex;
int ownedPid = 0;
bool ownedAlive = false;

/** Which of the two the pid in the file is: our own child, alive per its reaper, or one a pid alone names. */
bool ownedChild(int pid, bool& alive)
{
    std::lock_guard lock(ownedMutex);
    if (pid <= 0 || pid != ownedPid) return false;
    alive = ownedAlive;
    return true;
}
#endif

const std::vector<std::string> kNames = {"k7-runtime.exe", "k7-runtime"};

/** The checkout this executable was built in, found by walking up to `engine/k7-runtime`. */
std::optional<fs::path> repoRoot()
{
    const auto exe = process::executablePath();
    if (exe.empty()) return std::nullopt;
    for (fs::path dir = exe.parent_path(); !dir.empty(); dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::is_directory(dir / "engine" / "k7-runtime", ec)) return dir;
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
    const fs::path build = *root / "engine" / "k7-runtime" / "build";
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
    const auto rec = pidfile::read();
#ifdef K7_ENGINE_IN_APP
    // The pidfile names the app the engine lives in.
    return rec.pid > 0 && process::pidAlive(rec.pid);
#else
    if (bool alive = false; ownedChild(rec.pid, alive)) return alive;
    const bool alive = process::pidAlive(rec.pid);
    return pidfile::check(rec, pidfile::inspect(rec.pid), alive) != pidfile::Check::Stale;
#endif
}

namespace {
// Three answers, not two: a socket we could not even open says nothing about the engine — docs/supervisor.md.
enum class Probe { Up, Down, Unknown };

Probe probe(int port)
{
#ifdef _WIN32
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return Probe::Unknown;
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);
#else
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return Probe::Unknown;
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
    return up ? Probe::Up : Probe::Down;
}

#if !defined(_WIN32) && !defined(K7_ENGINE_IN_APP)
// The pid listening on `port`, asked of lsof; 0 when none, or when there is no lsof to ask.
int listenerPid(int port)
{
    auto lsof = process::findTool("lsof");
    // macOS keeps it in /usr/sbin, which an app's PATH does not list.
    if (lsof.empty() && fs::is_regular_file("/usr/sbin/lsof")) lsof = "/usr/sbin/lsof";
    std::string out;
    if (!process::runCapture(lsof, {"-t", "-nP", "-iTCP:" + std::to_string(port), "-sTCP:LISTEN"}, out))
        return 0;
    return std::atoi(out.c_str());
}
#endif
}  // namespace

bool isServing(int port)
{
    return probe(port) == Probe::Up;
}

#ifdef K7_ENGINE_IN_APP
namespace {
// How long the app gets to bind the engine's port: JUCE and the audio device come up first.
constexpr auto kAppStartBound = std::chrono::seconds(20);

// The process the engine is a thread of: our parent on Android, which runs us as its child; ourselves on iOS, a library like the engine.
int appPid()
{
#ifdef K7_IOS
    return process::currentPid();
#else
    return static_cast<int>(getppid());
#endif
}
}  // namespace

StartResult start(const EngineIdentity& identity, int port, const std::string& origins, int safeModeCrashes)
{
    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    const int app = appPid();
    if (isServing(port)) {
        std::ofstream(paths::enginePid(), std::ios::trunc) << app;
        log::host("adopting the engine the app already serves on :" + std::to_string(port));
        return {StartKind::Adopted, app};
    }
    protocol::emit({{"t", "engine"}, {"action", "start"}, {"id", identity.id}, {"token", identity.token},
                    {"port", port}, {"host", "0.0.0.0"}, {"origins", origins}, {"safeMode", safeModeCrashes}});
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
StartResult start(const EngineIdentity& identity, int port, const std::string& origins, int safeModeCrashes)
{
    if (running()) {
        // A pid is not an identity, so the PORT is asked too — here, where a wrong answer costs a spare engine.
        const auto answer = probe(port);
        if (answer == Probe::Up) {
            const auto rec = pidfile::read();
            bool alive = false;
            // A bare-pid file whose process the OS now shows to be the engine is upgraded, so a later stop may reach it.
            if (!ownedChild(rec.pid, alive) && !rec.verified())
                if (const auto live = pidfile::inspect(rec.pid); live && pidfile::check(*live, live, true) == pidfile::Check::Same)
                    pidfile::write(*live);
            log::host("adopting the engine already on the pidfile");
            return {StartKind::Adopted};
        }
        // Out of descriptors, say: the engine may be fine, and dropping its pidfile would orphan it for good.
        if (answer == Probe::Unknown)
            return {StartKind::Error, 0, "could not open a socket to ask :" + std::to_string(port) +
                                             " — keeping the engine on the pidfile"};
        log::host("pidfile names a live process but nothing answers :" + std::to_string(port) +
                  " — stale, starting a fresh engine");
        std::error_code ec;
        fs::remove(paths::enginePid(), ec);
    }
#ifndef _WIN32
    // An engine answering with no pidfile naming it: a fresh one could only fail to bind, so take that one.
    if (probe(port) == Probe::Up) {
        if (const int pid = listenerPid(port); pid > 0) {
            const auto rec = pidfile::recordOf(pid);
            // Something else on the engine's port is no engine of ours: never recorded, so never killed.
            if (!rec.exe.empty() && !pidfile::isEngineExecutable(rec.exe))
                return {StartKind::Error, 0, rec.exe + " (pid " + std::to_string(pid) + ") already serves :" +
                                                 std::to_string(port) + " — stop it, then start again"};
            pidfile::write(rec);
            log::host("adopting the engine already serving :" + std::to_string(port) + " (pid " +
                      std::to_string(pid) + "), which no pidfile named");
            return {StartKind::Adopted, pid};
        }
        return {StartKind::Error, 0, "something already serves :" + std::to_string(port) +
                                         " and no pid could be found for it — stop it, then start again"};
    }
#endif
    const auto bin = findBinary();
    if (!bin) return {StartKind::Missing};

    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    process::SpawnOptions opts;
    opts.program = *bin;
    opts.args = {std::to_string(port)};
    // Reachable on the LAN for a browser on another machine; loopback works as well.
    opts.env = {{"STUDIO_ENGINE_HOST", "0.0.0.0"},
                {"STUDIO_ENGINE_ID", identity.id},
                {"STUDIO_ENGINE_TOKEN", identity.token},
                {"STUDIO_ENGINE_ALLOWED_ORIGINS", origins},
                // Always set, so a value in the supervisor's own environment never puts a normal start in safe mode.
                {"STUDIO_ENGINE_SAFE_MODE", std::to_string(safeModeCrashes)}};
    opts.onLine = [](const std::string& line, bool) { log::line("engine", line); };
    opts.onExit = [](int pid) {
        std::lock_guard lock(ownedMutex);
        if (pid == ownedPid) ownedAlive = false;
    };
    // Held across the spawn, so an engine that dies at once is not marked alive after its reaper ran.
    std::unique_lock owned(ownedMutex);
    const auto spawned = process::spawn(opts);
    if (!spawned.pid) return {StartKind::Error, 0, spawned.error};
    ownedPid = spawned.pid;
    ownedAlive = true;
    owned.unlock();
    auto rec = pidfile::recordOf(spawned.pid);
    if (rec.exe.empty()) rec.exe = paths::utf8(*bin);
    pidfile::write(rec);
    log::host("engine started (pid " + std::to_string(spawned.pid) + ") on :" + std::to_string(port) +
              (safeModeCrashes > 0 ? " in safe mode" : ""));
    return {StartKind::Spawned, spawned.pid};
}

void stop()
{
    const auto rec = pidfile::read();
    bool alive = false;
    if (ownedChild(rec.pid, alive)) {
        // Our child, unreaped while alive, so its pid is still its own: the whole TREE goes, scan children included.
        if (alive) process::killTree(rec.pid);
    } else if (rec.pid > 0) {
        const auto verdict = pidfile::check(rec, pidfile::inspect(rec.pid), process::pidAlive(rec.pid));
        if (verdict == pidfile::Check::Same) process::killTree(rec.pid);
        else if (verdict == pidfile::Check::Unverified)
            log::host("not killing pid " + std::to_string(rec.pid) + ": the pidfile cannot prove it is the engine");
    }
    std::error_code ec;
    fs::remove(paths::enginePid(), ec);
}
#endif

}  // namespace k7::engine
