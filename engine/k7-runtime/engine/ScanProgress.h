// ScanProgress.h — where the plugin scan stands, as every socket may ask it: files done of files
// listed, the one being loaded, and how many scans this process has finished. JUCE-free and
// header-only, so tests/ has it in a FAST binary. The one thing a reader would get wrong: `total`
// is 0 while the plugin folders are still being listed, which is a scan, not an empty one.

#pragma once

#include <chrono>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace studio {

// One answer to "is this engine scanning, and how far along" — what `plugin-scan` carries.
struct PluginScanStatus {
    bool scanning = false;
    int done = 0;
    int total = 0;
    std::string current;
    // Scans this process has finished: a client that saw N is told N+1 is the catalogue to read again.
    int version = 0;
};

// A file's entry in the cache, as the plan reads it: when it was scanned, and whether its description is whole.
struct CachedScanEntry {
    long long mtime = 0;
    bool complete = false;
};

// Reuse what the cache holds only when the file is unchanged AND the entry carries a full description (docs/plugins.md).
inline bool reuseCachedEntry(const CachedScanEntry* old, long long mtime) {
    return old != nullptr && old->complete && old->mtime == mtime;
}

// The cached ids a scan of `present` drops: files no longer on disk, never a `builtin:` entry, which has no file.
inline std::vector<std::string> droppedEntries(const std::vector<std::string>& cached,
                                               const std::set<std::string>& present) {
    std::vector<std::string> out;
    for (const auto& id : cached)
        if (id.rfind("builtin:", 0) != 0 && present.count(id) == 0) out.push_back(id);
    return out;
}

// The shared status and its rate limit: the scan writes it from its thread, a socket reads it from its own.
class ScanProgressBoard {
public:
    using Clock = std::chrono::steady_clock;

    explicit ScanProgressBoard(std::chrono::milliseconds interval = std::chrono::milliseconds(250))
        : interval_(interval) {}

    // A scan starts: nothing listed yet. Always worth saying.
    PluginScanStatus begin(Clock::time_point now) {
        std::lock_guard<std::mutex> lk(m_);
        s_.scanning = true;
        s_.done = 0;
        s_.total = 0;
        s_.current.clear();
        last_ = now;
        return s_;
    }

    // One file further; true when a client should hear it now — a load starting, or the interval gone by.
    bool step(int done, int total, const std::string& loading, Clock::time_point now,
              PluginScanStatus& out) {
        std::lock_guard<std::mutex> lk(m_);
        s_.done = done;
        s_.total = total;
        s_.current = loading;
        out = s_;
        // A load can take twenty seconds, so its name goes out at once rather than behind the throttle.
        const bool due = (!loading.empty() && loading != said_) || now - last_ >= interval_;
        if (due) {
            last_ = now;
            said_ = loading;
        }
        return due;
    }

    // The scan ended, whether it found anything or not: the catalogue is the one to read now.
    PluginScanStatus finish() {
        std::lock_guard<std::mutex> lk(m_);
        s_.scanning = false;
        s_.current.clear();
        s_.done = s_.total;
        ++s_.version;
        said_.clear();
        return s_;
    }

    PluginScanStatus snapshot() const {
        std::lock_guard<std::mutex> lk(m_);
        return s_;
    }

private:
    mutable std::mutex m_;
    PluginScanStatus s_;
    std::chrono::milliseconds interval_;
    Clock::time_point last_{};
    std::string said_;
};

}  // namespace studio
