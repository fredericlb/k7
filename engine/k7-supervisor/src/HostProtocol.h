// HostProtocol.h — the wire contract with the app that runs us: NDJSON on stdio, a whole SNAPSHOT per frame
// and only when its bytes changed, commands back with one string argument. The wire's one definition is
// packages/supervisor-host/schema/hostProtocol.schema.json; stateFrame() is held to its fixtures by the tests.
// Stdout carries frames and nothing else: one stray line and the app parses garbage. See docs/hostProtocol.md.

#pragma once

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace k7::protocol {

/** What joins `audio.priority`'s names and `plugin.showUI`'s two halves: U+001F, which no name contains. */
inline const std::string kUnitSep = "\x1f";

struct AudioDevice {
    std::string name;
    std::string deviceType;
    bool current = false;
    // The device the engine takes its INPUTS from — another one than `current` when the setup is split.
    bool currentInput = false;
    // The open device's channel counts, on the row each belongs to; 0 on every other row.
    int inputs = 0;
    int outputs = 0;
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

/** A LAN device asking to pair: the musician compares `code` with the one the device shows (docs/hostProtocol.md). */
struct PairRequest {
    std::string requestId;
    std::string name;
    std::string ip;
    std::string code;
    std::int64_t since = 0;  // epoch ms
};

/** A LAN device the engine trusts until it is revoked. */
struct PairedDevice {
    std::string deviceId;
    std::string name;
    std::int64_t created = 0;  // epoch ms
    std::int64_t lastSeen = 0;  // epoch ms
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

/** One instrument the supervisor is fetching for the engine (Instruments.h) — what an app's status line says while it runs. */
struct Download {
    std::string name;
    std::string label;
    std::uint64_t received = 0;
    std::uint64_t total = 0;
    std::string phase;  // "queued" | "downloading" | "unpacking" | "failed"
    std::string error;
};

/** One row of an app's instrument list: an instrument this machine can fetch, and where it stands. */
struct InstrumentRow {
    std::string name;
    std::string label;
    std::uint64_t bytes = 0;
    /** The user keeps it: fetched when missing, fetched again when the list pins a newer archive. */
    bool wanted = false;
    bool installed = false;
};

/** The engine runs without external plugins after `crashes` quick crashes; `suspect` is the plugin it names, if any (docs/crashLoop.md). */
struct SafeMode {
    int crashes = 0;
    std::string suspect;
};

/** The whole of what an app draws. */
struct Snapshot {
    std::string status = "stopped";  // "stopped" | "running" | "error"
    std::string error;
    std::optional<SafeMode> safeMode;
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
    std::vector<InstrumentRow> instruments;
    std::vector<PairRequest> pairRequests;
    std::vector<PairedDevice> pairedDevices;
};

/** One command from the app; `id` is echoed on its result. */
struct Command {
    int id = 0;
    std::string cmd;
    std::string arg;
};

/** The `state` frame for a snapshot, keys in a fixed order, since a frame is sent only when its bytes change. */
nlohmann::ordered_json stateFrame(const Snapshot& s);

/** The `result` frame answering command `id`. */
nlohmann::ordered_json resultFrame(int id, bool ok, const std::string& message = "");

/** A line off stdin as a command, or nothing for a blank, unparseable or foreign line. */
std::optional<Command> parseCommand(const std::string& line);

/** Write one frame to the real stdout as a single line; the only writer to stdout. */
void emit(const nlohmann::ordered_json& frame);

/** `--config`: no host reads stdout, so no frame is written to it. */
void silenceFrames();

#ifndef _WIN32
/** Frames to `fd` instead of stdout, for a supervisor embedded in an app whose stdout others write to too; -1 is stdout again. */
void sendFramesTo(int fd);
#endif

/** Split `s` on U+001F, dropping empty parts. */
std::vector<std::string> splitUnits(const std::string& s);

}  // namespace k7::protocol
