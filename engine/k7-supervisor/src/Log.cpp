// Log.cpp — see Log.h. The file is opened lazily, in append mode, and each line is ONE write. A
// rotation closes it, moves it aside and opens a fresh one; a reader holding an old offset then
// finds the file shorter than it and seeds again from the tail (`readLog`).

#include "Log.h"

#include "Paths.h"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <memory>
#include <mutex>

namespace k7::log {

namespace fs = std::filesystem;

namespace {

std::mutex mutex;
std::unique_ptr<std::ofstream> file;
std::uintmax_t written = 0;
bool tried = false;
bool alone = false;

std::string stamp()
{
    const std::time_t now = std::time(nullptr);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &now);
#else
    localtime_r(&now, &tm);
#endif
    char buf[16];
    std::snprintf(buf, sizeof buf, "%02d:%02d:%02d", tm.tm_hour, tm.tm_min, tm.tm_sec);
    return buf;
}

/** Open the log, truncated or appended to; an oversized one is set aside first. */
void open(bool truncate)
{
    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    const fs::path p = paths::mergedLog();
    if (!truncate) rotate(p, kRotateAbove);
    auto f = std::make_unique<std::ofstream>(p, (truncate ? std::ios::trunc : std::ios::app) | std::ios::binary);
    if (!*f) return;
    const auto size = truncate ? 0 : fs::file_size(p, ec);
    written = ec ? 0 : size;
    file = std::move(f);
}

std::ofstream* out()
{
    if (!tried) {
        tried = true;
        open(alone);
    }
    return file.get();
}

}  // namespace

bool rotate(const fs::path& p, std::uintmax_t limit)
{
    std::error_code ec;
    const auto size = fs::file_size(p, ec);
    if (ec || size <= limit) return false;
    fs::path aside = p;
    aside += ".1";
    // Removed first, so the move never rests on the platform replacing a file.
    fs::remove(aside, ec);
    fs::rename(p, aside, ec);
    return !ec;
}

void line(const std::string& tag, const std::string& text)
{
    const std::string l = stamp() + " [" + tag + "] " + text + "\n";
    std::lock_guard lock(mutex);
    if (file && written + l.size() > kRotateAbove) {
        file.reset();
        const bool moved = rotate(paths::mergedLog(), 0);
        open(moved);
        // A file Windows would not let go of (a reader has it open) is kept, and tried again a whole size later.
        if (!moved) written = 0;
    }
    if (auto* f = out()) {
        f->write(l.data(), static_cast<std::streamsize>(l.size()));
        f->flush();
        written += l.size();
    }
    if (alone) std::fwrite(l.data(), 1, l.size(), stderr);
}

void standalone()
{
    std::lock_guard lock(mutex);
    alone = true;
}

void stderrOnly(const std::string& text)
{
    std::lock_guard lock(mutex);
    std::fprintf(stderr, "%s\n", text.c_str());
}

}  // namespace k7::log
