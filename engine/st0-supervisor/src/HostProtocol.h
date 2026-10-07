// HostProtocol.h — the wire contract with the tray: NDJSON on stdio, a whole SNAPSHOT per frame and
// only when its bytes changed, commands back with one string argument. The tray mirrors these shapes
// by hand in Rust (host.rs) and computes no policy of its own. Stdout carries frames and nothing else:
// one stray line and the tray parses garbage. See docs/supervisor.md.

#pragma once

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace st0::protocol {

/** What joins `audio.priority`'s names and `plugin.showUI`'s two halves: U+001F, which no name contains. */
inline const std::string kUnitSep = "\x1f";

struct AudioDevice {
    std::string name;
    std::string deviceType;
    bool current = false;
};

struct EditPlugin {
    std::string session;
    std::string id;
    std::string name;
    bool hasNativePluginUI = false;
};

struct Plugin {
    std::string name;
    std::string format;
    std::string manufacturer;
    std::string role;
};

struct Session {
    std::string id;
    std::string project;
    bool loaded = false;
    bool playing = false;
    int tracks = 0;
    int listeners = 0;
};

struct Instance {
    std::string url;
    bool removable = false;
};

struct InstanceCheck {
    std::string url;
    std::string state;  // "checking" | "refused"
    std::string message;
};

/** One instrument the supervisor is fetching for the engine (Instruments.h) — what the tray's menu says while it runs. */
struct Download {
    std::string name;
    std::string label;
    std::uint64_t received = 0;
    std::uint64_t total = 0;
    std::string phase;  // "downloading" | "unpacking" | "failed"
    std::string error;
};

/** The whole of what the tray draws. */
struct Snapshot {
    std::string status = "stopped";  // "stopped" | "running" | "error"
    std::string error;
    bool ownsEngine = false;
    bool userStopped = false;
    std::string engineId;
    int enginePort = 8765;
    std::string registryUrl;
    bool lastHeartbeatOk = false;
    std::vector<Session> sessions;
    std::string sessionsSig;
    std::optional<int> pluginCount;
    std::vector<Plugin> plugins;
    std::string pluginsSig;
    std::vector<AudioDevice> audioDevices;
    std::vector<std::string> audioPriority;
    std::string audioMenuSig;
    std::vector<EditPlugin> editPlugins;
    std::string editPluginsSig;
    std::vector<Instance> instances;
    std::optional<InstanceCheck> instanceCheck;
    std::string rootPath;
    std::string mergedLogPath;
    std::vector<Download> downloads;
};

/** One command from the tray; `id` is echoed on its result. */
struct Command {
    int id = 0;
    std::string cmd;
    std::string arg;
};

/** The `state` frame for a snapshot, keys in the order the TypeScript supervisor wrote them. */
nlohmann::ordered_json stateFrame(const Snapshot& s);

/** The `result` frame answering command `id`. */
nlohmann::ordered_json resultFrame(int id, bool ok, const std::string& message = "");

/** A line off stdin as a command, or nothing for a blank, unparseable or foreign line. */
std::optional<Command> parseCommand(const std::string& line);

/** Write one frame to the real stdout as a single line; the only writer to stdout. */
void emit(const nlohmann::ordered_json& frame);

/** Split `s` on U+001F, dropping empty parts. */
std::vector<std::string> splitUnits(const std::string& s);

}  // namespace st0::protocol
