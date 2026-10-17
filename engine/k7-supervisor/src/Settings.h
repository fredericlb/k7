// Settings.h — the supervisor's persisted settings, `<state>/engine-host.json`: small and
// hand-editable on purpose, so each field is validated on its own and one bad key never loses the
// others. Older spellings are migrated in the READER (`registryUrl`, `audioDevice` + `audioFallback`).
// See docs/supervisor.md.

#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace k7 {

struct Settings {
    /** The k7 instances the user added, as their pl8 registries; overrides `$STUDIO_REGISTRY_URL`. */
    std::vector<std::string> registryUrls;
    /** The engine's WebSocket port: the first one tried, the next free one taken unless `portFixed`. */
    int port = 8765;
    /** `--port`: that port or none, for a firewall rule or a LAN address someone wrote down; never saved. */
    bool portFixed = false;
    /** The interfaces in the user's order, best first; the first one PRESENT is where the engine goes. */
    std::vector<std::string> audioPriority;
    /** The ONNX execution providers this machine separates on, lowercased; empty is the CPU. */
    std::vector<std::string> onnxProviders;
    /** The instruments this machine keeps, by name; absent until a first boot settles it (docs/instruments.md). */
    std::optional<std::vector<std::string>> instruments;
    /** The device token each studio paired this machine with, by registry URL: what a studio that lists paired machines only asks. */
    std::map<std::string, std::string> deviceTokens;
};

/** Parse a settings document leniently; anything missing or malformed falls back to its default. */
Settings settingsFrom(const nlohmann::json& raw);

/** The document `settingsFrom` reads back unchanged. */
nlohmann::json settingsJson(const Settings& s);

/** Read `<state>/engine-host.json`; absent or unreadable is the defaults. */
Settings loadSettings();

/** Write it; an unwritable home keeps the value for this session only rather than failing the click. */
void saveSettings(const Settings& s);

/** `--config`: settings come from `file` instead, and are never written back — the file is the user's. */
void useConfigFile(const std::filesystem::path& file);

/** `--port`: every load after this has that port, fixed. */
void useFixedPort(int port);

/** The config file's keys that the supervisor otherwise reads from the environment, as (variable, value). */
std::vector<std::pair<std::string, std::string>> configEnvironment(const nlohmann::json& raw);

/** Lowercased, trimmed and deduplicated, since ORT's provider names are lowercase. */
std::vector<std::string> normaliseProviders(const nlohmann::json& v);

}  // namespace k7
