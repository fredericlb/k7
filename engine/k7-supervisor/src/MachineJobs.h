// MachineJobs.h — what this MACHINE does when a server asks over a jobs channel: separate a mix on
// its CPU, say where a médiathèque song is on its disk, count a set list brought down ahead of a gig,
// read its log, keep what it separates on, keep an undo's audio and send it back. Paths arrive already local and leave already the server's:
// the tunnel moves the files. The TS reference agent's jobs are the twin; see docs/supervisor.md.

#pragma once

#include "TunnelAgent.h"

#include <chrono>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace k7 {

/** What the jobs need of the supervisor's state, which lives on its loop and nowhere else. */
struct MachineAccess {
    /** Read the providers — or write them first, given a list — through the one owner of the settings. */
    std::function<std::vector<std::string>(const std::optional<std::vector<std::string>>& set)> onnxProviders;
};

/** Every job this machine answers, by request type. */
tunnel::Jobs machineJobs(const MachineAccess& access);

/** The most of the log one `log` job reads, whatever the file has grown to. */
constexpr std::uint64_t kLogReadCap = 1024 * 1024;

/** A slice of the merged log: with `offset`, the new whole lines since it; without, or past the end, the last `tail`. */
nlohmann::json readLog(std::optional<std::uint64_t> offset, std::optional<int> tail);

/** How long this machine keeps an undo's audio after it was last kept or sent back. */
constexpr std::chrono::hours kKeptHistoryTtl{24 * 30};

/** Delete every file under `<remoteRoot>/<server>/history-*` unused for `ttl`; answers how many went. */
std::size_t purgeKeptHistory(const std::filesystem::path& remoteRoot, std::chrono::hours ttl = kKeptHistoryTtl);

}  // namespace k7
