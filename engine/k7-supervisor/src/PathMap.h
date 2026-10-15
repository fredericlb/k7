// PathMap.h — the engine names files by LOCAL path and the server by its own; this rewrites every
// JSON string under a shared root as a frame crosses, and moves the file FIRST: downloaded before a
// frame naming it reaches the engine, uploaded before a frame naming a file the engine wrote reaches
// the server. Whole strings only, never substrings. A channel the server syncs itself (`sync`) only
// rewrites. The twin of engine-tunnel/pathMap.ts.

#pragma once

#include "TunnelFiles.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <vector>

namespace k7::tunnel {

struct MappedRoot {
    /** The server's absolute POSIX path. */
    std::string remote;
    /** Where this machine keeps its copy, in the local path style, as UTF-8. */
    std::string local;
    bool writable = false;
};

/** Whether Windows would open this name as a device (CON, NUL, COM1, LPT1 and the rest), whatever its case or extension. */
bool reservedDeviceName(const std::string& seg);

/** One name between separators that can only name a child: no `.`, `..`, separator, drive, control char or device name. */
bool safeSegment(const std::string& seg);

/** `rest` — the `/`-separated part of a server path below its root — under `localRoot`, or nothing if it could leave it. */
std::optional<std::string> joinUnder(const std::string& localRoot, const std::string& rest);

/** The `/`-separated part of `local` below `localRoot` ("" for the root itself), or nothing if it is not lexically inside. */
std::optional<std::string> relativeUnder(const std::string& localRoot, const std::string& local);

/** What is known to be the same on both sides, and the downloads in flight — one per agent. */
class SyncLedger {
public:
    struct Synced {
        std::uint64_t size;
        double localMtimeMs;
        double remoteMtimeMs;
    };
    std::optional<Synced> get(const std::string& local);
    void set(const std::string& local, Synced s);

    /** Run `fetch` unless a download of `local` is already in flight, then wait for whichever runs. */
    void downloadOnce(const std::string& local, const std::function<void()>& fetch);

    /** Where the current version of `canonical` lives when it could not replace a held file, if anywhere. */
    std::optional<std::string> redirect(const std::string& canonical);
    /** The canonical path a redirected copy stands for. */
    std::optional<std::string> canonicalOf(const std::string& actual);
    /** Point `canonical` at `actual` (itself to clear); answers the copy it pointed at before, if any. */
    std::optional<std::string> place(const std::string& canonical, const std::string& actual);

private:
    std::mutex mutex_;
    std::map<std::string, Synced> synced_;
    std::map<std::string, std::string> redirects_;
    std::map<std::string, std::shared_future<void>> downloads_;
};

/** How far a `sync` has got: only the files it had to copy count, not those already here. */
struct SyncProgress {
    std::uint64_t files = 0;
    std::uint64_t filesDone = 0;
    std::uint64_t bytes = 0;
    std::uint64_t bytesDone = 0;
    /** One line per file that did not arrive: its name, then why — never a path, which the map would upload. */
    std::vector<std::string> failures;
};

class PathMap {
public:
    PathMap(std::vector<MappedRoot> roots, RemoteFiles files, SyncLedger& ledger, std::function<void(const std::string&)> log);

    /** The local spelling of a server path under a shared root. */
    std::optional<std::string> toLocal(const std::string& remote) const;

    /** The server spelling of a local path under a shared root, with its root. */
    std::optional<std::pair<std::string, const MappedRoot*>> toRemote(const std::string& local) const;

    /** Bring ONE file down by its local path; false when the server has no such file. */
    bool ensureLocal(const std::string& local);

    /** A server→engine frame, rewritten; with `fetch`, every file it names present locally first, which blocks. */
    std::string outbound(const std::string& text, bool fetch = true);

    /** Bring every listed LOCAL path up to date, reporting after each copy; returns the last report. Blocks. */
    SyncProgress sync(const std::vector<std::string>& locals, const std::function<void(const SyncProgress&)>& progress);

    /** An engine→server frame, rewritten, every file the engine changed uploaded first. Blocks. */
    std::string inbound(const std::string& text);

private:
    /** The fixed local spelling of a server path, which keys the ledger whatever copy is current. */
    std::optional<std::string> canonical(const std::string& remote) const;
    /** The copy of `canonical` the engine should open. */
    std::string actual(const std::string& canonical) const;
    void place(const std::string& canonical, const std::string& actual);
    void bringDown(const std::vector<RemoteStat>& entries);
    bool upToDate(const RemoteStat& e, const std::string& local);
    void ensureFile(const RemoteStat& e, const std::string& local);
    void sendUp(const std::string& local);

    std::vector<MappedRoot> roots_;
    std::vector<std::string> remoteNeedles_;
    std::vector<std::string> localNeedles_;
    RemoteFiles files_;
    SyncLedger& ledger_;
    std::function<void(const std::string&)> log_;
};

}  // namespace k7::tunnel
