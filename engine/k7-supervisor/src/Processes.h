// Processes.h — the three things the supervisor does with processes: ask whether a pid is alive,
// start a child in a process group of its own with its output piped, and kill a child AND
// everything it spawned. A plain kill reaches one pid, and a plugin-scan child left behind holds
// the audio device. POSIX and Win32 each need their own mechanism. See docs/supervisor.md.

#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace k7::process {

/** This process's pid. */
int currentPid();

/** This executable, symlinks resolved; empty when the platform will not say. */
std::filesystem::path executablePath();

/** Whether `pid` names a live process — ours or not; a pid is not an identity, so callers ask more. */
bool pidAlive(int pid);

/** Kill `pid` and its descendants: its process group on POSIX, `taskkill /T /F` on Windows. */
void killTree(int pid);

/** A started child; its two output streams are drained into `onLine` on threads of their own. */
struct Spawned {
    int pid = 0;
    std::string error;
};

struct SpawnOptions {
    std::filesystem::path program;
    std::vector<std::string> args;
    /** Merged over this process's environment. */
    std::map<std::string, std::string> env;
    /** One call per complete output line, from a pump thread; `true` for stderr. */
    std::function<void(const std::string& line, bool isErr)> onLine;
};

/** Start a detached child in its own process group; `pid` 0 and `error` set when it could not. */
Spawned spawn(const SpawnOptions& opts);

/** Run a program to completion, `out` receiving what it printed; false when it could not start. */
bool runCapture(const std::filesystem::path& program, const std::vector<std::string>& args, std::string& out);

/** What `run` gives back: the exit code, -1 when it did not start, and the two streams apart. */
struct RunResult {
    int code = -1;
    std::string out;
    std::string err;
};

/** Run a program to completion, `input` on its stdin, its stdout and stderr captured APART. */
RunResult run(const std::filesystem::path& program, const std::vector<std::string>& args, const std::string& input = {});

/** Windows: when `$STUDIO_HOST_PID` names our host, join a kill-on-close job only the host holds; elsewhere a no-op. Returns why it failed, empty on success. */
std::string joinHostJob();

/** A tool by name: on PATH, then where a package manager puts it — an app's PATH is not a shell's. */
std::filesystem::path findTool(const std::string& name);

}  // namespace k7::process
