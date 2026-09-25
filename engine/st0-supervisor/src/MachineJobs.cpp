// MachineJobs.cpp — see MachineJobs.h. `raw` carries what must reach the server in THIS machine's
// spelling — a local path, a log line naming one — and the tunnel leaves it unmapped.

#include "MachineJobs.h"

#include "Paths.h"
#include "Separation.h"
#include "Settings.h"

#include <filesystem>
#include <fstream>
#include <sstream>

namespace st0 {

namespace fs = std::filesystem;
using nlohmann::json;
using ojson = nlohmann::ordered_json;

namespace {

std::vector<std::string> splitLines(const std::string& s)
{
    std::vector<std::string> out;
    size_t start = 0;
    while (start < s.size()) {
        size_t nl = s.find('\n', start);
        if (nl == std::string::npos) nl = s.size();
        std::string line = s.substr(start, nl - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        out.push_back(line);
        start = nl + 1;
    }
    return out;
}

std::string readAll(const fs::path& p)
{
    std::ifstream in(p, std::ios::binary);
    std::stringstream buf;
    buf << in.rdbuf();
    return buf.str();
}

}  // namespace

json readLog(std::optional<std::uint64_t> offset, std::optional<int> tail)
{
    // Merged first, then the engine-only log a run without the supervisor writes.
    fs::path file;
    std::error_code ec;
    for (const auto& p : {paths::mergedLog(), paths::engineLog()})
        if (fs::is_regular_file(p, ec)) {
            file = p;
            break;
        }
    if (file.empty()) return {{"offset", 0}, {"lines", json::array()}};
    const std::string buf = readAll(file);
    const std::uint64_t size = buf.size();
    if (offset && *offset <= size) {
        const size_t lastNl = buf.rfind('\n');
        // Nothing complete since the offset yet.
        if (lastNl == std::string::npos || lastNl < *offset) return {{"offset", *offset}, {"lines", json::array()}};
        const std::uint64_t end = lastNl + 1;
        return {{"offset", end}, {"lines", splitLines(buf.substr(*offset, end - *offset))}};
    }
    auto all = splitLines(buf);
    const size_t n = static_cast<size_t>(std::max(1, tail.value_or(300)));
    if (all.size() > n) all.erase(all.begin(), all.end() - static_cast<long>(n));
    return {{"offset", size}, {"lines", all}};
}

tunnel::Jobs machineJobs(const MachineAccess& access)
{
    tunnel::Jobs jobs;

    // Where a song of the médiathèque is on THIS disk, brought down first by the channel.
    jobs["local"] = [](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        const std::string path = req.value("path", "");
        std::error_code ec;
        if (path.empty() || !fs::exists(paths::fromUtf8(path), ec)) throw std::runtime_error("not in the médiathèque");
        emit({{"type", "local"}, {"raw", {{"path", path}}}});
    };

    // The set list's songs, already brought down by the channel before this runs — so this only counts.
    jobs["prefetch"] = [](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        int count = 0;
        std::error_code ec;
        for (const auto& f : req.value("files", json::array()))
            if (f.is_string() && fs::exists(paths::fromUtf8(f.get<std::string>()), ec)) ++count;
        emit({{"type", "prefetched"}, {"count", count}});
    };

    jobs["log"] = [](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        std::optional<std::uint64_t> offset;
        std::optional<int> tail;
        if (auto it = req.find("offset"); it != req.end() && it->is_number() && it->get<double>() >= 0)
            offset = it->get<std::uint64_t>();
        if (auto it = req.find("tail"); it != req.end() && it->is_number()) tail = it->get<int>();
        emit({{"type", "log"}, {"raw", readLog(offset, tail)}});
    };

    // What this machine separates on; given `set`, written first — the server's `system onnx` asks here.
    jobs["onnx-providers"] = [access](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        std::optional<std::vector<std::string>> set;
        if (auto it = req.find("set"); it != req.end() && it->is_array()) set = normaliseProviders(*it);
        emit({{"type", "onnx-providers"}, {"providers", access.onnxProviders(set)}});
    };

    // Split a mix with a model, both already on this disk; one reply per change, the last `separated`.
    jobs["separate"] = [access](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        separation::Request r;
        r.user = req.value("user", "");
        r.source = req.value("source", "");
        r.model = req.value("model", "");
        r.outDir = req.value("outDir", "");
        for (const auto& o : req.value("outputs", json::array()))
            if (o.is_string()) r.outputs.push_back(o.get<std::string>());
        r.providers = access.onnxProviders(std::nullopt);
        separation::run(r, [&](const json& job) {
            emit({{"type", job.value("done", false) ? "separated" : "separating"}, {"job", job}});
        });
    };

    return jobs;
}

}  // namespace st0
