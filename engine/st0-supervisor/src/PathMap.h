// PathMap.h — the engine names files by LOCAL path and the server by its own; this rewrites every
// JSON string under a shared root as a frame crosses, and moves the file FIRST: downloaded before a
// frame naming it reaches the engine, uploaded before a frame naming a file the engine wrote reaches
// the server. Whole strings only, never substrings. The twin of engine-tunnel/pathMap.ts.

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

namespace st0::tunnel {

struct MappedRoot {
    /** The server's absolute POSIX path. */
    std::string remote;
    /** Where this machine keeps its copy, in the local path style, as UTF-8. */
    std::string local;
    bool writable = false;
};

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

private:
    std::mutex mutex_;
    std::map<std::string, Synced> synced_;
    std::map<std::string, std::shared_future<void>> downloads_;
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

    /** A server→engine frame, rewritten, every file it names present locally first. Blocks. */
    std::string outbound(const std::string& text);

    /** An engine→server frame, rewritten, every file the engine changed uploaded first. Blocks. */
    std::string inbound(const std::string& text);

private:
    void bringDown(const std::vector<RemoteStat>& entries);
    void ensureFile(const RemoteStat& e, const std::string& local);
    void sendUp(const std::string& local);

    std::vector<MappedRoot> roots_;
    std::vector<std::string> remoteNeedles_;
    std::vector<std::string> localNeedles_;
    RemoteFiles files_;
    SyncLedger& ledger_;
    std::function<void(const std::string&)> log_;
};

}  // namespace st0::tunnel
