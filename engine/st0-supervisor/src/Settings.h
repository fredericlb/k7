// Settings.h — the supervisor's persisted settings, `<state>/engine-host.json`: small and
// hand-editable on purpose, so each field is validated on its own and one bad key never loses the
// others. Older spellings are migrated in the READER (`registryUrl`, `audioDevice` + `audioFallback`).
// See docs/supervisor.md.

#pragma once

#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <vector>

namespace st0 {

struct Settings {
    /** The st0 instances the user added, as their pl8 registries; overrides `$STUDIO_REGISTRY_URL`. */
    std::vector<std::string> registryUrls;
    /** The engine's WebSocket port. */
    int port = 8765;
    /** The interfaces in the user's order, best first; the first one PRESENT is where the engine goes. */
    std::vector<std::string> audioPriority;
    /** The ONNX execution providers this machine separates on, lowercased; empty is the CPU. */
    std::vector<std::string> onnxProviders;
    /** The instruments this machine keeps, by name; absent until a first boot settles it (docs/instruments.md). */
    std::optional<std::vector<std::string>> instruments;
};

/** Parse a settings document leniently; anything missing or malformed falls back to its default. */
Settings settingsFrom(const nlohmann::json& raw);

/** The document `settingsFrom` reads back unchanged. */
nlohmann::json settingsJson(const Settings& s);

/** Read `<state>/engine-host.json`; absent or unreadable is the defaults. */
Settings loadSettings();

/** Write it; an unwritable home keeps the value for this session only rather than failing the click. */
void saveSettings(const Settings& s);

/** Lowercased, trimmed and deduplicated, since ORT's provider names are lowercase. */
std::vector<std::string> normaliseProviders(const nlohmann::json& v);

}  // namespace st0
