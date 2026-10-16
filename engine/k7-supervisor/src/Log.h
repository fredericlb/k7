// Log.h — the merged log: one `HH:MM:SS [tag] text` line per event, APPENDED to `<state>/.studio.log`,
// which the Logs panel reads by byte offset. The format is load-bearing. This process is the file's only
// writer, so it is also what keeps it bounded: past `kRotateAbove` it becomes `.studio.log.1`. Under an
// app nothing is echoed to stderr; run from a config (`standalone`), the session is ours, so we truncate
// and echo. Thread-safe. See docs/supervisorPolicy.md.

#pragma once

#include <cstdint>
#include <filesystem>
#include <string>

namespace k7::log {

/** Past this size the log is set aside as `.studio.log.1`, at its open and while it runs. */
constexpr std::uintmax_t kRotateAbove = 8 * 1024 * 1024;

/** Write one tagged, timestamped line; never throws, and an unwritable file is silence. */
void line(const std::string& tag, const std::string& text);

/** A line under the supervisor's own tag. */
inline void host(const std::string& text) { line("host", text); }

/** To stderr, which an app files under its own tag — for what should read as the app's view of us. */
void stderrOnly(const std::string& text);

/** `--config`: truncate the file at its first open, and echo every line to stderr — no app does either. */
void standalone();

/** Move `file` to `<file>.1`, replacing the previous one, when it is larger than `limit`; true when it moved. */
bool rotate(const std::filesystem::path& file, std::uintmax_t limit);

}  // namespace k7::log
