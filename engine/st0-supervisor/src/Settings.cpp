// Settings.cpp — see Settings.h.

#include "Settings.h"

#include "Paths.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>

namespace st0 {

namespace {

// Set by `--config`; empty means `<state>/engine-host.json`, the file an app's commands save.
std::filesystem::path gConfigFile;

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
    return s;
}

nlohmann::json settingsJson(const Settings& s)
{
    nlohmann::json j = {
        {"registryUrls", s.registryUrls},
        {"port", s.port},
        {"audioPriority", s.audioPriority},
        {"onnxProviders", s.onnxProviders},
    };
    if (s.instruments) j["instruments"] = *s.instruments;
    return j;
}

void useConfigFile(const std::filesystem::path& file) { gConfigFile = file; }

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
    std::ifstream in(gConfigFile.empty() ? paths::settings() : gConfigFile, std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    auto raw = nlohmann::json::parse(buf.str(), nullptr, false);
    return raw.is_discarded() ? Settings{} : settingsFrom(raw);
}

void saveSettings(const Settings& s)
{
    if (!gConfigFile.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories(paths::studioDir(), ec);
    std::ofstream out(paths::settings(), std::ios::binary | std::ios::trunc);
    if (out) out << settingsJson(s).dump(2) << "\n";
}

}  // namespace st0
