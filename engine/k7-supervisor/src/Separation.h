// Separation.h — splitting a mix into stems on this machine: decode it (SeparationDecode.h), run HT-Demucs
// window by window on ONNX Runtime, fold the overlapping windows back, write 24-bit WAVs. A job is
// keyed by its WORK, so a second request for the same cut joins the one running rather than
// starting another. The C++ port of packages/stem-separation; see its docs/stemSplit.md.

#pragma once

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <vector>

namespace k7::separation {

struct Request {
    std::string user;
    /** The mix, a local path. */
    std::string source;
    /** The .onnx, a local path. */
    std::string model;
    /** Where the stems land. */
    std::string outDir;
    /** What to write; the four stems when empty. */
    std::vector<std::string> outputs;
    /** Execution providers to try, in order; the CPU when empty. */
    std::vector<std::string> providers;
};

/** Run (or join) the separation `r` describes, calling `report` with the job — web-protocol's SeparateJob — on every change, the last with `done`. Blocks. */
void run(const Request& r, const std::function<void(const nlohmann::json& job)>& report);

}  // namespace k7::separation
