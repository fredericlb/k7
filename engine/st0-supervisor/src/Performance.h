// Performance.h — measures this machine once, for the rating the heartbeat carries: one core's DSP
// throughput, the cores, a durable write and an fsync rate on the state dir's disk, the memory. Run
// before the engine starts, so the CPU loop does not measure a plugin scan. The SCORING is
// packages/web-protocol/performance.ts's, ported line for line and tested against its numbers.

#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <optional>

namespace st0::performance {

struct Metrics {
    double cores = 0;
    double singleThread = 0;
    std::optional<double> diskWriteMBps;
    std::optional<double> fsyncPerSec;
    double memoryGB = 0;
};

/** 1000 × the weighted geometric mean of each metric over the reference machine's. */
int score(const Metrics& m);

/** Measure, well under a second; `dir` is where the disk probe writes. */
Metrics measure(const std::filesystem::path& dir);

/** The heartbeat's `performance` object: the metrics and their score. */
nlohmann::json toJson(const Metrics& m);

}  // namespace st0::performance
