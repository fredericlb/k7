// HostProtocol.cpp — see HostProtocol.h. Frames are dumped compact: a newline inside one ends it
// early, and the app would parse the rest as a second, broken frame.

#include "HostProtocol.h"

#include "Log.h"

#include <cstdio>
#include <atomic>
#include <mutex>

#ifndef _WIN32
#include <cerrno>
#include <unistd.h>
#endif

namespace k7::protocol {

using ojson = nlohmann::ordered_json;

ojson stateFrame(const Snapshot& s)
{
    ojson f;
    f["t"] = "state";
    f["owns"] = {{"engine", true}, {"engineQueries", true}};
    f["status"] = s.status;
    if (!s.error.empty()) f["error"] = s.error;
    if (s.safeMode) f["safeMode"] = {{"crashes", s.safeMode->crashes}, {"suspect", s.safeMode->suspect}};
    f["ownsEngine"] = s.ownsEngine;
    f["userStopped"] = s.userStopped;
    f["engineId"] = s.engineId;
    f["enginePort"] = s.enginePort;
    f["registryUrl"] = s.registryUrl;
    f["lastHeartbeatOk"] = s.lastHeartbeatOk;
    f["pluginCount"] = s.pluginCount ? ojson(*s.pluginCount) : ojson(nullptr);
    ojson plugins = ojson::array();
    for (const auto& p : s.plugins)
        plugins.push_back({{"name", p.name}, {"format", p.format}, {"manufacturer", p.manufacturer}, {"role", p.role}});
    f["plugins"] = plugins;
    f["pluginsSig"] = s.pluginsSig;
    ojson devices = ojson::array();
    for (const auto& d : s.audioDevices)
        devices.push_back({{"name", d.name},
                           {"deviceType", d.deviceType},
                           {"current", d.current},
                           {"currentInput", d.currentInput},
                           {"inputs", d.inputs},
                           {"outputs", d.outputs}});
    f["audioDevices"] = devices;
    f["audioPriority"] = s.audioPriority;
    f["audioMenuSig"] = s.audioMenuSig;
    f["lanOpen"] = s.lanOpen;
    ojson edit = ojson::array();
    for (const auto& e : s.editPlugins)
        edit.push_back({{"session", e.session}, {"id", e.id}, {"name", e.name}, {"hasNativePluginUI", e.hasNativePluginUI}});
    f["editPlugins"] = edit;
    f["editPluginsSig"] = s.editPluginsSig;
    ojson sessions = ojson::array();
    for (const auto& x : s.sessions)
        sessions.push_back({{"id", x.id},
                            {"project", x.project},
                            {"loaded", x.loaded},
                            {"playing", x.playing},
                            {"tracks", x.tracks},
                            {"listeners", x.listeners}});
    f["sessions"] = sessions;
    f["sessionsSig"] = s.sessionsSig;
    ojson instances = ojson::array();
    for (const auto& i : s.instances) instances.push_back({{"url", i.url}, {"removable", i.removable}});
    f["instances"] = instances;
    if (s.instanceCheck) {
        ojson c = {{"url", s.instanceCheck->url}, {"state", s.instanceCheck->state}};
        if (!s.instanceCheck->message.empty()) c["message"] = s.instanceCheck->message;
        f["instanceCheck"] = c;
    } else {
        f["instanceCheck"] = nullptr;
    }
    f["paths"] = {{"root", s.rootPath}, {"mergedLog", s.mergedLogPath}};
    // Absent rather than empty when nothing is being fetched — the common case, and the app defaults it.
    if (!s.downloads.empty()) {
        ojson downloads = ojson::array();
        for (const auto& d : s.downloads) {
            ojson o = {{"name", d.name}, {"label", d.label}, {"received", d.received}, {"total", d.total}, {"phase", d.phase}};
            if (!d.error.empty()) o["error"] = d.error;
            downloads.push_back(o);
        }
        f["downloads"] = downloads;
    }
    ojson instruments = ojson::array();
    for (const auto& i : s.instruments)
        instruments.push_back(
            {{"name", i.name}, {"label", i.label}, {"bytes", i.bytes}, {"wanted", i.wanted}, {"installed", i.installed}});
    f["instruments"] = instruments;
    ojson requests = ojson::array();
    for (const auto& r : s.pairRequests)
        requests.push_back({{"requestId", r.requestId}, {"name", r.name}, {"ip", r.ip}, {"code", r.code}, {"since", r.since}});
    f["pairRequests"] = requests;
    ojson paired = ojson::array();
    for (const auto& d : s.pairedDevices)
        paired.push_back({{"deviceId", d.deviceId}, {"name", d.name}, {"created", d.created}, {"lastSeen", d.lastSeen}});
    f["pairedDevices"] = paired;
    return f;
}

ojson resultFrame(int id, bool ok, const std::string& message)
{
    ojson f = {{"t", "result"}, {"id", id}, {"ok", ok}};
    if (!message.empty()) f["message"] = message;
    return f;
}

std::optional<Command> parseCommand(const std::string& line)
{
    size_t a = line.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return std::nullopt;
    auto msg = nlohmann::json::parse(line, nullptr, false);
    if (msg.is_discarded()) {
        // A malformed line is the app's bug, not a reason to die: say so and keep the channel open.
        log::stderrOnly("[host] ignoring unparseable command: " + line);
        return std::nullopt;
    }
    if (!msg.is_object() || msg.value("t", "") != "cmd" || !msg.contains("cmd") || !msg["cmd"].is_string())
        return std::nullopt;
    Command c;
    c.cmd = msg["cmd"].get<std::string>();
    if (auto it = msg.find("id"); it != msg.end() && it->is_number()) c.id = it->get<int>();
    if (auto it = msg.find("arg"); it != msg.end() && it->is_string()) c.arg = it->get<std::string>();
    return c;
}

namespace {
std::atomic<bool> gSilent{false};
std::atomic<int> gFramesFd{-1};
}

void silenceFrames() { gSilent = true; }

#ifndef _WIN32
void sendFramesTo(int fd) { gFramesFd = fd; }
#endif

void emit(const ojson& frame)
{
    if (gSilent) return;
    static std::mutex mutex;
    const std::string line = frame.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + "\n";
    std::lock_guard lock(mutex);
#ifndef _WIN32
    if (const int fd = gFramesFd; fd >= 0) {
        // A failed write is the app gone, as a closed stdout is: the frame is dropped, never retried forever.
        for (size_t at = 0; at < line.size();) {
            const ssize_t n = ::write(fd, line.data() + at, line.size() - at);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) return;
            at += static_cast<size_t>(n);
        }
        return;
    }
#endif
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
}

std::vector<std::string> splitUnits(const std::string& s)
{
    std::vector<std::string> out;
    size_t start = 0;
    while (start <= s.size()) {
        const size_t sep = s.find(kUnitSep, start);
        const std::string part = s.substr(start, sep == std::string::npos ? std::string::npos : sep - start);
        if (!part.empty()) out.push_back(part);
        if (sep == std::string::npos) break;
        start = sep + kUnitSep.size();
    }
    return out;
}

}  // namespace k7::protocol
