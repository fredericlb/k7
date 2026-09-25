// MachineJobs.h — what this MACHINE does when a server asks over a jobs channel: separate a mix on
// its CPU, say where a médiathèque song is on its disk, count a set list brought down ahead of a gig,
// read its log, keep what it separates on. Paths arrive already local and leave already the server's:
// the tunnel moves the files. The twin of engine-host's machineJobs.ts; see docs/supervisor.md.

#pragma once

#include "TunnelAgent.h"

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace st0 {

/** What the jobs need of the supervisor's state, which lives on its loop and nowhere else. */
struct MachineAccess {
    /** Read the providers — or write them first, given a list — through the one owner of the settings. */
    std::function<std::vector<std::string>(const std::optional<std::vector<std::string>>& set)> onnxProviders;
};

/** Every job this machine answers, by request type. */
tunnel::Jobs machineJobs(const MachineAccess& access);

/** A slice of the merged log: with `offset`, the new whole lines since it; without, the last `tail`. */
nlohmann::json readLog(std::optional<std::uint64_t> offset, std::optional<int> tail);

}  // namespace st0
