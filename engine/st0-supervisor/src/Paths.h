// Paths.h — the state directory's layout as the supervisor reads and writes it: `~/.st0`, or
// `$STUDIO_HOME`. The C++ twin of packages/engine-client/src/paths.ts, and the two must spell every
// name the same way — a wrong path does not throw, it reads as an empty file. See docs/supervisor.md.

#pragma once

#include <filesystem>
#include <string>

namespace st0::paths {

namespace fs = std::filesystem;

/** `~/.st0`, or `$STUDIO_HOME`, absolute and normalised. */
fs::path studioDir();

/** The engine's `{ id, token, createdAt }`. */
fs::path engineId();

/** The running engine's pid — what lets a fresh supervisor adopt an orphaned engine. */
fs::path enginePid();

/** The running supervisor's pid — one per machine. */
fs::path hostPid();

/** The supervisor's own settings, JSON. */
fs::path settings();

/** The plugin scan cache the engine writes; deleted before a forced rescan. */
fs::path extsCache();

/** The engine log written when NOT under the supervisor. */
fs::path engineLog();

/** The merged log — the engine's and the supervisor's lines, tagged. */
fs::path mergedLog();

/** `<state>/workspace`, which the tray still names in its snapshot. */
fs::path rootDir();

/** `<state>/remote/<host>` — one server's files as this machine holds them. */
fs::path remoteCache(const std::string& key);

/** A path as UTF-8, whatever the platform's native encoding — for JSON and logs. */
std::string utf8(const fs::path& p);

}  // namespace st0::paths
