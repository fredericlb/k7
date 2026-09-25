// Log.h — the merged log: one `HH:MM:SS [tag] text` line per event, APPENDED to `<state>/.studio.log`,
// which the tray opens and the Logs panel reads by byte offset. The format is load-bearing, and
// truncation is the tray's alone. NOT echoed to stderr: the tray already drains our stderr into
// this same file, so an echo would be every line twice. Thread-safe. See docs/supervisor.md.

#pragma once

#include <string>

namespace st0::log {

/** Write one tagged, timestamped line; never throws, and an unwritable file is silence. */
void line(const std::string& tag, const std::string& text);

/** A line under the supervisor's own tag. */
inline void host(const std::string& text) { line("host", text); }

/** To stderr, which the tray files under its own tag — for what should read as the tray's view of us. */
void stderrOnly(const std::string& text);

}  // namespace st0::log
