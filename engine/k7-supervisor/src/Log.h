// Log.h — the merged log: one `HH:MM:SS [tag] text` line per event, APPENDED to `<state>/.studio.log`,
// which the Logs panel reads by byte offset. The format is load-bearing. Under an app, truncation is the
// app's and nothing is echoed to stderr, which the app files into this same file; run from a config
// (`standalone`), the session is ours, so we truncate and echo. Thread-safe. See docs/supervisor.md.

#pragma once

#include <string>

namespace k7::log {

/** Write one tagged, timestamped line; never throws, and an unwritable file is silence. */
void line(const std::string& tag, const std::string& text);

/** A line under the supervisor's own tag. */
inline void host(const std::string& text) { line("host", text); }

/** To stderr, which an app files under its own tag — for what should read as the app's view of us. */
void stderrOnly(const std::string& text);

/** `--config`: truncate the file at its first open, and echo every line to stderr — no app does either. */
void standalone();

}  // namespace k7::log
