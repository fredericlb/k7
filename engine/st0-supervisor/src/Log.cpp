// Log.cpp — see Log.h. The file is opened once, lazily, in append mode, and each line is ONE
// write, which is what lets an app's own `[host]` lines interleave without tearing.

#include "Log.h"

#include "Paths.h"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <mutex>

namespace st0::log {

namespace {

std::mutex mutex;
std::ofstream* file = nullptr;
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

std::ofstream* out()
{
    if (tried) return file;
    tried = true;
    std::error_code ec;
    std::filesystem::create_directories(paths::studioDir(), ec);
    auto* f = new std::ofstream(paths::mergedLog(), (alone ? std::ios::trunc : std::ios::app) | std::ios::binary);
    if (!*f) {
        delete f;
        return nullptr;
    }
    file = f;
    return file;
}

}  // namespace

void line(const std::string& tag, const std::string& text)
{
    const std::string l = stamp() + " [" + tag + "] " + text + "\n";
    std::lock_guard lock(mutex);
    if (auto* f = out()) {
        f->write(l.data(), static_cast<std::streamsize>(l.size()));
        f->flush();
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

}  // namespace st0::log
