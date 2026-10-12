// Instruments.h — the sampled instruments this machine's engine plays, fetched by the SUPERVISOR when the engine
// starts rather than by a server: hundreds of MB each, they come straight from their origin onto the machine
// that plays them, once, and are pinned by hash. A module names one as `@instruments/<name>/<file>.sfz`, which
// the engine resolves under `<state>/instruments`. See docs/instruments.md.
#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace st0::instruments {

namespace fs = std::filesystem;

/** One instrument: its folder name, what the tray calls it, the archive it unpacks from, and that archive's identity. */
struct Instrument {
    std::string name;
    std::string label;
    std::string url;
    std::string sha256;
    std::uint64_t bytes = 0;
};

/** Every instrument the engine can play — what the tray's Downloads tab lists. */
const std::vector<Instrument>& all();

/** The one named `name`, or null. */
const Instrument* find(const std::string& name);

/** `<state>/instruments`. */
fs::path root();

/** Whether `i` is unpacked, AND from the archive this list pins: an older one is fetched again. */
bool installed(const Instrument& i);

/** Whether ANY archive of `i` was installed here, the pinned one or an older one — what a first boot keeps. */
bool present(const Instrument& i);

/** Delete `i`'s folder and whatever a cut-short install left beside it. False with `error` when something stays. */
bool remove(const Instrument& i, std::string& error);

/** Where a download stands; `phase` is "downloading", "unpacking" or "failed". */
struct Progress {
    std::uint64_t received = 0;
    std::uint64_t total = 0;
    std::string phase;
};

/** Fetch, verify and unpack `i` into root(), blocking — a worker thread's call; `report` runs on that thread. */
bool install(const Instrument& i, const std::function<void(const Progress&)>& report, std::string& error);

/** Unpack `zip` into `folder` — a sibling first, renamed when whole; one top folder dropped. False with `error` on any refusal. */
bool unpackZip(const fs::path& zip, const fs::path& folder, std::string& error);

/** The hex SHA-256 of a file, empty when it cannot be read. */
std::string sha256Of(const fs::path& file);

}  // namespace st0::instruments
