// PidFile.h — `<state>/engine.pid` as an IDENTITY rather than a number: the pid, the process's start
// time and its executable, so a pid the OS has since handed to another program is never adopted or
// killed. A file holding a bare pid still reads, as an unverified record: adopted on its port, never
// killed. The start time is the OS's own figure, spelled as packages/supervisor-host reads it too
// (docs/supervisor.md).

#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace k7::pidfile {

struct Record {
    int pid = 0;
    /** macOS: start, seconds since the epoch; Linux: field 22 of /proc/<pid>/stat; Windows: creation FILETIME. "" when unknown. */
    std::string start;
    std::string exe;
    /** The port the engine was started on; 0 in a file written before it was recorded. */
    int port = 0;
    bool verified() const { return pid > 0 && !start.empty(); }
};

/** Read either format: a bare pid, or the pid then `start=`, `exe=` and `port=` lines; pid 0 for anything else. */
Record parse(const std::string& text);

/** The pid on the first line, so a reader that only takes the leading number still gets it. */
std::string format(const Record& r);

/** What the OS says of a live `pid` now; nothing when it is gone or will not say. */
std::optional<Record> inspect(int pid);

/** Whether `exe` is the engine by its name, `k7-runtime` or `k7-runtime.exe`. */
bool isEngineExecutable(const std::string& exe);

enum class Check {
    /** Same start time and the engine's executable: this IS the engine the file was written for. */
    Same,
    /** A bare-pid file, or a live process the OS will not describe: adopt on the port, never kill. */
    Unverified,
    /** Gone, or another process now holds the pid. */
    Stale,
};

/** Judge `recorded` against what `live` (`inspect` of its pid) and `alive` (`pidAlive`) say. */
Check check(const Record& recorded, const std::optional<Record>& live, bool alive);

/** `<state>/engine.pid`, parsed; a missing file is pid 0. */
Record read();

/** Replace `<state>/engine.pid` with `r`. */
void write(const Record& r);

/** The live identity of `pid` when the OS gives it, else a bare-pid record. */
Record recordOf(int pid);

}  // namespace k7::pidfile
