// HostLock.cpp — see HostLock.h. Creation is exclusive (`O_EXCL` / `CREATE_NEW`), which is the
// atomic part: two supervisors racing cannot both win.

#include "HostLock.h"

#include "Log.h"
#include "Paths.h"
#include "Processes.h"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace k7::hostlock {

namespace fs = std::filesystem;

namespace {

constexpr auto kStale = std::chrono::milliseconds(15000);

int readPid()
{
    std::ifstream in(paths::hostPid());
    int pid = 0;
    if (!(in >> pid)) return 0;
    return pid;
}

void writePid()
{
    std::ofstream out(paths::hostPid(), std::ios::trunc);
    out << process::currentPid() << "\n";
}

// Created AND written through the one handle, so the file names its holder from the moment it exists.
bool createExclusive(const fs::path& p)
{
    const std::string pid = std::to_string(process::currentPid()) + "\n";
#ifdef _WIN32
    HANDLE h = CreateFileW(p.wstring().c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wrote = 0;
    WriteFile(h, pid.data(), static_cast<DWORD>(pid.size()), &wrote, nullptr);
    CloseHandle(h);
    return true;
#else
    const int fd = open(p.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0644);
    if (fd < 0) return false;
    const ssize_t wrote = write(fd, pid.data(), pid.size());
    (void)wrote;
    close(fd);
    return true;
#endif
}

}  // namespace

int heldBy()
{
    const auto path = paths::hostPid();
    std::error_code ec;
    if (!fs::exists(path, ec)) return 0;
    const int pid = readPid();
    const auto written = fs::last_write_time(path, ec);
    const bool fresh = !ec && fs::file_time_type::clock::now() - written < kStale;
    if (pid > 0 && pid != process::currentPid() && process::pidAlive(pid) && fresh) return pid;
    // A fresh file naming nobody is a supervisor between its create and its write: held, by a pid not known yet.
    if (pid <= 0 && fresh) return -1;
    fs::remove(path, ec);
    return 0;
}

int acquire()
{
    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    // Exclusive on every attempt: a stale lock removed here may be re-created by another supervisor before ours.
    for (int attempt = 0; attempt < 3; ++attempt) {
        if (int holder = heldBy()) return holder;
        if (createExclusive(paths::hostPid())) return 0;
    }
    const int pid = readPid();
    return pid > 0 ? pid : -1;
}

void refresh()
{
    // Read before writing: a lock naming somebody else was taken from us, and that is said.
    const int held = readPid();
    if (held != 0 && held != process::currentPid()) {
        log::stderrOnly("[host] the supervisor lock was taken by pid " + std::to_string(held) +
                        " — two supervisors are running");
        return;
    }
    writePid();
}

void release()
{
    if (readPid() == process::currentPid()) {
        std::error_code ec;
        fs::remove(paths::hostPid(), ec);
    }
}

}  // namespace k7::hostlock
