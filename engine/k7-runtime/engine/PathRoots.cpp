// PathRoots.cpp — see PathRoots.h. Containment is checked component by component on the RESOLVED paths,
// so `/root-other` is not under `/root` and a link inside a root that points out of it does not count.

#include "PathRoots.h"

#include <cstdlib>
#include <filesystem>
#include <mutex>
#include <optional>

namespace studio {

namespace fs = std::filesystem;

namespace {

std::mutex g_lock;
bool g_set = false;
PathRootSet g_roots;

fs::path fromUtf8(const std::string& s) { return fs::path(std::u8string(s.begin(), s.end())); }

char lowerAscii(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c; }

// The absolute path with every existing link resolved, or nothing when the system cannot say.
std::optional<fs::path> resolved(const std::string& s) {
    std::error_code ec;
    const fs::path abs = fs::absolute(fromUtf8(s), ec);
    if (ec) return std::nullopt;
    const fs::path real = fs::weakly_canonical(abs, ec);
    if (ec) return std::nullopt;
    return real.lexically_normal();
}

bool sameComponent(const fs::path& a, const fs::path& b) {
#ifdef _WIN32
    const auto x = a.u8string();
    const auto y = b.u8string();
    if (x.size() != y.size()) return false;
    for (size_t i = 0; i < x.size(); ++i)
        if (lowerAscii((char)x[i]) != lowerAscii((char)y[i])) return false;
    return true;
#else
    return a == b;
#endif
}

bool inside(const fs::path& path, const fs::path& root) {
    auto p = path.begin();
    for (auto r = root.begin(); r != root.end(); ++r) {
        // A trailing separator is an empty last component, which names nothing.
        if (r->empty()) continue;
        if (p == path.end() || !sameComponent(*p, *r)) return false;
        ++p;
    }
    return true;
}

bool allowed(const std::string& path, bool write) {
    if (path.empty() || isUncPath(path)) return false;
    std::lock_guard<std::mutex> g(g_lock);
    if (!g_set) return true;
    return pathUnderRoots(path, write ? g_roots.write : g_roots.read);
}

}  // namespace

bool isUncPath(const std::string& path) {
    if (path.size() < 2) return false;
    const auto sep = [](char c) { return c == '/' || c == '\\'; };
    return sep(path[0]) && sep(path[1]);
}

bool hasExtensionCi(const std::string& path, const std::string& ext) {
    if (path.size() <= ext.size()) return false;
    const size_t at = path.size() - ext.size();
    for (size_t i = 0; i < ext.size(); ++i)
        if (lowerAscii(path[at + i]) != lowerAscii(ext[i])) return false;
    return true;
}

bool pathUnderRoots(const std::string& path, const std::vector<std::string>& roots) {
    if (path.empty() || isUncPath(path)) return false;
    const auto real = resolved(path);
    if (!real) return false;
    for (const auto& root : roots) {
        if (root.empty() || isUncPath(root)) continue;
        if (const auto r = resolved(root); r && inside(*real, *r)) return true;
    }
    return false;
}

bool safeSoundName(const std::string& name) {
    if (name.empty() || name == "." || name == "..") return false;
    for (const char c : name) {
        if (c == '/' || c == '\\' || (unsigned char)c < 0x20) return false;
#ifdef _WIN32
        if (c == ':') return false;
#endif
    }
    return true;
}

std::vector<std::string> splitRootList(const std::string& list) {
#ifdef _WIN32
    const char sep = ';';
#else
    const char sep = ':';
#endif
    std::vector<std::string> out;
    size_t from = 0;
    while (from <= list.size()) {
        const size_t to = list.find(sep, from);
        const std::string part = list.substr(from, to == std::string::npos ? std::string::npos : to - from);
        if (!part.empty()) out.push_back(part);
        if (to == std::string::npos) break;
        from = to + 1;
    }
    return out;
}

void setPathRoots(PathRootSet roots) {
    std::lock_guard<std::mutex> g(g_lock);
    g_roots = std::move(roots);
    g_set = true;
}

PathRootSet defaultPathRoots(const std::string& stateDir) {
    PathRootSet set;
    if (!stateDir.empty()) set.write.push_back(stateDir);
    if (const char* extra = std::getenv("STUDIO_ENGINE_ROOTS"))
        for (auto& r : splitRootList(extra)) set.write.push_back(std::move(r));
    set.read = set.write;
    std::error_code ec;
    const auto tmp = fs::temp_directory_path(ec);
    if (!ec) {
        const auto u8 = tmp.u8string();
        set.read.emplace_back(u8.begin(), u8.end());
    }
    return set;
}

bool readAllowed(const std::string& path) { return allowed(path, false); }

bool writeAllowed(const std::string& path) { return allowed(path, true); }

}  // namespace studio
