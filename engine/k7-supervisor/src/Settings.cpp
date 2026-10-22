// Settings.cpp — see Settings.h.

#include "Settings.h"

#include "Paths.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>

namespace k7 {

namespace {

// Set by `--config`; empty means `<state>/engine-host.json`, the file an app's commands save.
std::filesystem::path gConfigFile;
// Set by `--port`; 0 means the settings' port, the first of a range.
int gFixedPort = 0;

std::string trim(const std::string& s)
{
    size_t a = 0, b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

/** The non-empty strings of a JSON array, first occurrence kept, in order. */
std::vector<std::string> uniqueStrings(const nlohmann::json& v)
{
    std::vector<std::string> out;
    if (!v.is_array()) return out;
    for (const auto& e : v)
        if (e.is_string()) {
            const std::string s = e.get<std::string>();
            if (!s.empty() && std::find(out.begin(), out.end(), s) == out.end()) out.push_back(s);
        }
    return out;
}

std::string str(const nlohmann::json& raw, const char* key)
{
    auto it = raw.find(key);
    return it != raw.end() && it->is_string() ? it->get<std::string>() : std::string();
}

}  // namespace

std::vector<std::string> normaliseProviders(const nlohmann::json& v)
{
    std::vector<std::string> out;
    if (!v.is_array()) return out;
    for (const auto& e : v) {
        std::string s = e.is_string() ? trim(e.get<std::string>()) : std::string();
        std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
        if (!s.empty() && std::find(out.begin(), out.end(), s) == out.end()) out.push_back(s);
    }
    return out;
}

Settings settingsFrom(const nlohmann::json& raw)
{
    Settings s;
    if (!raw.is_object()) return s;
    s.registryUrls = uniqueStrings(raw.value("registryUrls", nlohmann::json()));
    if (s.registryUrls.empty())
        if (auto one = str(raw, "registryUrl"); !one.empty()) s.registryUrls = {one};
    if (auto it = raw.find("port"); it != raw.end() && it->is_number_integer()) {
        const auto p = it->get<long long>();
        if (p > 0 && p < 65536) s.port = static_cast<int>(p);
    }
    s.audioPriority = uniqueStrings(raw.value("audioPriority", nlohmann::json()));
    if (s.audioPriority.empty())
        for (const char* key : {"audioDevice", "audioFallback"})
            if (auto v = str(raw, key);
                !v.empty() && std::find(s.audioPriority.begin(), s.audioPriority.end(), v) == s.audioPriority.end())
                s.audioPriority.push_back(v);
    s.onnxProviders = normaliseProviders(raw.value("onnxProviders", nlohmann::json()));
    // An array, even an empty one, is a choice; anything else is "never chosen", which a boot settles.
    if (auto it = raw.find("instruments"); it != raw.end() && it->is_array()) s.instruments = uniqueStrings(*it);
    if (auto it = raw.find("deviceTokens"); it != raw.end() && it->is_object())
        for (const auto& [k, v] : it->items())
            if (v.is_string() && !trim(v.get<std::string>()).empty()) s.deviceTokens[k] = trim(v.get<std::string>());
    // A config file's one `deviceToken` is the token of the studios that same file names.
    if (auto one = trim(str(raw, "deviceToken")); !one.empty())
        for (const auto& u : s.registryUrls) s.deviceTokens.emplace(u, one);
    if (auto it = raw.find("lanOpen"); it != raw.end() && it->is_boolean()) s.lanOpen = it->get<bool>();
    return s;
}

nlohmann::json settingsJson(const Settings& s)
{
    nlohmann::json j = {
        {"registryUrls", s.registryUrls},
        {"port", s.port},
        {"audioPriority", s.audioPriority},
        {"onnxProviders", s.onnxProviders},
        {"lanOpen", s.lanOpen},
    };
    if (s.instruments) j["instruments"] = *s.instruments;
    if (!s.deviceTokens.empty()) j["deviceTokens"] = s.deviceTokens;
    return j;
}

void useConfigFile(const std::filesystem::path& file) { gConfigFile = file; }

void useFixedPort(int port) { gFixedPort = port; }

std::vector<std::pair<std::string, std::string>> configEnvironment(const nlohmann::json& raw)
{
    std::vector<std::pair<std::string, std::string>> out;
    if (!raw.is_object()) return out;
    for (const auto& [key, var] : {std::pair{"machineName", "STUDIO_MACHINE_NAME"},
                                   std::pair{"extraCaCerts", "STUDIO_EXTRA_CA_CERTS"},
                                   std::pair{"renderKey", "STUDIO_RENDER_KEY"}})
        if (auto v = trim(str(raw, key)); !v.empty()) out.emplace_back(var, v);
    // "all" keeps every instrument, as `$STUDIO_INSTRUMENTS=all` does (docs/instruments.md).
    if (auto it = raw.find("instruments"); it != raw.end() && it->is_array())
        for (const auto& e : *it)
            if (e.is_string() && e.get<std::string>() == "all") out.emplace_back("STUDIO_INSTRUMENTS", "all");
    return out;
}

Settings loadSettings()
{
    Settings s;
    if (std::ifstream in(gConfigFile.empty() ? paths::settings() : gConfigFile, std::ios::binary); in) {
        std::stringstream buf;
        buf << in.rdbuf();
        if (auto raw = nlohmann::json::parse(buf.str(), nullptr, false); !raw.is_discarded()) s = settingsFrom(raw);
    }
    if (gFixedPort > 0) {
        s.port = gFixedPort;
        s.portFixed = true;
    }
    return s;
}

void saveSettings(const Settings& s)
{
    if (!gConfigFile.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories(paths::studioDir(), ec);
    const std::filesystem::path path = paths::settings();
    const auto tmp = path.parent_path() / (path.filename().string() + ".tmp");
    // Written beside, then renamed over: a crash mid-write must not leave a torn file that loads as defaults.
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return;
        out << settingsJson(s).dump(2) << "\n";
        out.flush();
        if (!out.good()) {
            out.close();
            std::filesystem::remove(tmp, ec);
            return;
        }
    }
    std::filesystem::rename(tmp, path, ec);
    if (ec) std::filesystem::remove(tmp, ec);
}

}  // namespace k7
