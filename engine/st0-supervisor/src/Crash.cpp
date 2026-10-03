// Crash.cpp — see Crash.h. The dump is taken from SIGABRT because MSVC's abort() raises it before its
// fail-fast, which no unhandled-exception filter ever sees; and set_terminate is per THREAD there, so
// the terminate handler only covers main's own thread while SIGABRT covers every one.

#include "Crash.h"

#include "Log.h"
#include "Paths.h"

#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <string>
#include <thread>

#ifdef _WIN32
#include <windows.h>

#include <dbghelp.h>
#endif

namespace st0::crash {

namespace {

std::atomic<bool> gReported{false};

std::string inFlight()
{
    const auto e = std::current_exception();
    if (!e) return "no exception in flight";
    try {
        std::rethrow_exception(e);
    } catch (const std::exception& x) {
        return std::string("uncaught exception: ") + x.what();
    } catch (...) {
        return "uncaught exception of an unknown type";
    }
}

#ifdef _WIN32
void writeDump(EXCEPTION_POINTERS* info)
{
    const auto file = paths::studioDir() / ("crash-supervisor-" + std::to_string(GetCurrentProcessId()) + ".dmp");
    HANDLE h = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    MINIDUMP_EXCEPTION_INFORMATION mei{GetCurrentThreadId(), info, FALSE};
    const auto kind = static_cast<MINIDUMP_TYPE>(MiniDumpWithThreadInfo | MiniDumpWithIndirectlyReferencedMemory);
    BOOL ok = FALSE;
    // From another thread: the caller's own stack — the throw site — is not captured reliably otherwise.
    std::thread([&] { ok = MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), h, kind, info ? &mei : nullptr, nullptr, nullptr); }).join();
    CloseHandle(h);
    if (ok) log::host("crash dump: " + paths::utf8(file));
}
#endif

/** Say why, once, whichever handler gets there first. */
void report(const std::string& how)
{
    if (gReported.exchange(true)) return;
    log::host("fatal: " + how + " — " + inFlight());
#ifdef _WIN32
    writeDump(nullptr);
#endif
}

extern "C" void onAbort(int) { report("abort()"); }

void onTerminate()
{
    report("std::terminate");
    std::abort();
}

#ifdef _WIN32
LONG WINAPI onUnhandled(EXCEPTION_POINTERS* info)
{
    if (!gReported.exchange(true)) {
        char code[16];
        std::snprintf(code, sizeof code, "0x%08lX", info->ExceptionRecord->ExceptionCode);
        log::host(std::string("fatal: unhandled exception ") + code);
        writeDump(info);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif

}  // namespace

void install()
{
    std::set_terminate(onTerminate);
    std::signal(SIGABRT, onAbort);
#ifdef _WIN32
    SetUnhandledExceptionFilter(onUnhandled);
#endif
}

}  // namespace st0::crash
