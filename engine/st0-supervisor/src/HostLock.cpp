// HostLock.cpp — see HostLock.h. Creation is exclusive (`O_EXCL` / `CREATE_NEW`), which is the
// atomic part: two supervisors racing cannot both win.

#include "HostLock.h"

#include "Log.h"
#include "Paths.h"
#include "Process.h"

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

namespace st0::hostlock {

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

bool createExclusive(const fs::path& p)
{
#ifdef _WIN32
    HANDLE h = CreateFileW(p.wstring().c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    CloseHandle(h);
    return true;
#else
    const int fd = open(p.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0) return false;
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
    fs::remove(path, ec);
    return 0;
}

int acquire()
{
    if (int holder = heldBy()) return holder;
    std::error_code ec;
    fs::create_directories(paths::studioDir(), ec);
    if (!createExclusive(paths::hostPid()))
        if (int now = heldBy()) return now;
    writePid();
    return 0;
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

}  // namespace st0::hostlock
