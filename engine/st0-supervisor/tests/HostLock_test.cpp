// HostLock_test.cpp — the pair docs/supervisorPolicy.md rests on: a lock whose pid is ALIVE but
// that nobody refreshed is taken, and a lock being refreshed is refused. Staleness must clear a
// recycled pid without becoming a way to steal a live supervisor's lock.

#include "FileTime.h"
#include "HostLock.h"
#include "Paths.h"
#include "Process.h"

#include "test_harness.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace {

/** A live process that is not us — our parent, which is alive for as long as we are. */
int foreignLivePid()
{
#ifdef _WIN32
    // System, always alive and never ours; OpenProcess refusing us still reads as alive.
    return 4;
#else
    return static_cast<int>(getppid());
#endif
}

void scratch()
{
    const auto dir = fs::temp_directory_path() / ("st0-lock-" + std::to_string(std::rand()));
    fs::create_directories(dir);
#ifdef _WIN32
    _putenv_s("STUDIO_HOME", dir.string().c_str());
#else
    setenv("STUDIO_HOME", dir.c_str(), 1);
#endif
}

double nowMs()
{
    return static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}

void aRefreshedLockIsRefused()
{
    scratch();
    const int other = foreignLivePid();
    std::ofstream(st0::paths::hostPid()) << other << "\n";
    CHECK(st0::hostlock::heldBy() == other);
    CHECK(st0::hostlock::acquire() == other);
}

void aStaleLockIsTakenEvenWhenItsPidLives()
{
    scratch();
    std::ofstream(st0::paths::hostPid()) << foreignLivePid() << "\n";
    st0::filetime::setMtimeMs(st0::paths::hostPid(), nowMs() - 20000);
    CHECK(st0::hostlock::acquire() == 0);
    std::ifstream in(st0::paths::hostPid());
    int pid = 0;
    in >> pid;
    CHECK(pid == st0::process::currentPid());
    st0::hostlock::release();
    CHECK(!fs::exists(st0::paths::hostPid()));
}

void aLockNamingSomebodyElseIsNotOverwritten()
{
    scratch();
    CHECK(st0::hostlock::acquire() == 0);
    const int other = foreignLivePid();
    std::ofstream(st0::paths::hostPid(), std::ios::trunc) << other << "\n";
    st0::hostlock::refresh();
    std::ifstream in(st0::paths::hostPid());
    int pid = 0;
    in >> pid;
    CHECK(pid == other);
    // And a release does not remove what is no longer ours.
    st0::hostlock::release();
    CHECK(fs::exists(st0::paths::hostPid()));
}

}  // namespace

void runHostLockTests()
{
    RUN(aRefreshedLockIsRefused);
    RUN(aStaleLockIsTakenEvenWhenItsPidLives);
    RUN(aLockNamingSomebodyElseIsNotOverwritten);
}
