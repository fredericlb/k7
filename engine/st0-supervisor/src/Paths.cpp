// Paths.cpp — see Paths.h. Home is `USERPROFILE` on Windows and `HOME` elsewhere, as Node's
// `os.homedir()` resolves it, so both supervisors land in the same directory.

#include "Paths.h"

#include <cstdlib>

namespace st0::paths {

namespace {

fs::path fromEnv(const char* name)
{
#ifdef _WIN32
    // The wide variant, so a home under a non-ASCII user name survives.
    std::wstring wname(name, name + std::char_traits<char>::length(name));
    if (const wchar_t* v = _wgetenv(wname.c_str()); v && *v) return fs::path(v);
#else
    if (const char* v = std::getenv(name); v && *v) return fs::path(v);
#endif
    return {};
}

}  // namespace

fs::path studioDir()
{
    fs::path dir = fromEnv("STUDIO_HOME");
    if (dir.empty()) {
#ifdef _WIN32
        fs::path home = fromEnv("USERPROFILE");
#else
        fs::path home = fromEnv("HOME");
#endif
        dir = home / ".st0";
    }
    std::error_code ec;
    fs::path abs = fs::absolute(dir, ec);
    return (ec ? dir : abs).lexically_normal();
}

fs::path engineId() { return studioDir() / "engine-id.json"; }
fs::path enginePid() { return studioDir() / "engine.pid"; }
fs::path hostPid() { return studioDir() / "engine-host.pid"; }
fs::path settings() { return studioDir() / "engine-host.json"; }
fs::path extsCache() { return studioDir() / "exts.json"; }
fs::path engineLog() { return studioDir() / ".studio-engine.log"; }
fs::path mergedLog() { return studioDir() / ".studio.log"; }
fs::path rootDir() { return studioDir() / "workspace"; }
fs::path remoteCache(const std::string& key) { return studioDir() / "remote" / fs::u8path(key); }

std::string utf8(const fs::path& p)
{
    auto s = p.u8string();
    return std::string(s.begin(), s.end());
}

}  // namespace st0::paths
