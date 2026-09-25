// FileTime.h — a file's size and modification time in the units the tunnel compares them in:
// milliseconds since the Unix epoch, as Node's `stat().mtimeMs` gives them. A download is stamped
// with the SERVER's mtime, which is what lets the next comparison skip it.

#pragma once

#include <filesystem>
#include <optional>

namespace st0::filetime {

struct Info {
    bool isFile = false;
    bool isDir = false;
    std::uint64_t size = 0;
    double mtimeMs = 0;
};

/** What is at `p`, or nothing when nothing is. */
std::optional<Info> stat(const std::filesystem::path& p);

/** Stamp `p` with a modification time in epoch milliseconds. */
void setMtimeMs(const std::filesystem::path& p, double ms);

/** Two mtimes the same to within the rounding a filesystem applies. */
inline bool same(double a, double b) { return a - b < 2 && b - a < 2; }

}  // namespace st0::filetime
