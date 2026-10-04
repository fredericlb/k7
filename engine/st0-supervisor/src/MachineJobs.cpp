// MachineJobs.cpp — see MachineJobs.h. `raw` carries what must reach the server in THIS machine's
// spelling — a local path, a log line naming one — and the tunnel leaves it unmapped.

#include "MachineJobs.h"

#include "EngineProcess.h"
#include "Paths.h"
#include "Processes.h"
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

std::size_t purgeKeptHistory(const fs::path& remoteRoot, std::chrono::hours ttl)
{
    // Listed first, removed after: an iterator over a folder being emptied is not one to trust.
    std::vector<fs::path> stale;
    const auto now = fs::file_time_type::clock::now();
    std::error_code serverEc;
    for (fs::directory_iterator server(remoteRoot, serverEc), end; !serverEc && server != end; server.increment(serverEc)) {
        std::error_code rootEc;
        for (fs::directory_iterator root(server->path(), rootEc), rend; !rootEc && root != rend; root.increment(rootEc)) {
            if (paths::utf8(root->path().filename()).rfind("history-", 0) != 0) continue;
            std::error_code fileEc;
            for (fs::recursive_directory_iterator f(root->path(), fileEc), fend; !fileEc && f != fend; f.increment(fileEc)) {
                std::error_code ec;
                if (!f->is_regular_file(ec)) continue;
                const auto at = fs::last_write_time(f->path(), ec);
                if (!ec && now - at >= ttl) stale.push_back(f->path());
            }
        }
    }
    std::size_t removed = 0;
    for (const auto& p : stale) {
        std::error_code ec;
        if (fs::remove(p, ec)) ++removed;
    }
    return removed;
}

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

    // Send this machine's copy of a file BACK up: an undo's audio, which only this machine keeps (packages/file-service/docs/history.md).
    jobs["send-up"] = [](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        const std::string file = req.value("file", "");
        std::error_code ec;
        const fs::path p = paths::fromUtf8(file);
        if (file.empty() || !fs::is_regular_file(p, ec)) throw std::runtime_error("not kept on this machine");
        // A fresh mtime is what makes the channel upload a file it last brought DOWN, and it counts as a use.
        fs::last_write_time(p, fs::file_time_type::clock::now(), ec);
        emit({{"type", "sent"}, {"file", file}});
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

    // Bounce a ProjectDoc through THIS machine's engine binary — the machine whose plugins the doc
    // names — to `out`, a server path in the writable render cache the tunnel uploads on the reply.
    // What a VST freeze is rendered with, since the server has no plugins (packages/song/docs/autoFreeze.md).
    // The doc's clip paths arrive already local: the channel brought them down before this ran.
    jobs["render"] = [](const json& req, const tunnel::Emit& emit, tunnel::JobContext&) {
        const std::string out = req.value("out", "");
        const auto doc = req.find("doc");
        if (out.empty() || doc == req.end() || !doc->is_object())
            throw std::runtime_error("render: a doc and an out path are required");
        const auto exe = engine::findBinary();
        if (!exe) throw std::runtime_error("no st0-engine binary on this machine to render with");

        std::error_code ec;
        const fs::path tmp = fs::temp_directory_path(ec) / ("st0-render-" + std::to_string(process::currentPid()) + "-" +
                                                             std::to_string(std::hash<std::string>{}(out)));
        fs::create_directories(tmp, ec);
        emit({{"type", "rendering"}});
        // The doc on stdin (`--render -`): no file of it to leave behind.
        const auto r = process::run(*exe, {"--render", "-", "--out", paths::utf8(tmp)}, doc->dump());
        const auto cleanup = [&] { fs::remove_all(tmp, ec); };
        if (r.code != 0) {
            cleanup();
            throw std::runtime_error("engine render failed (exit " + std::to_string(r.code) + ")");
        }
        // The manifest is the LAST line the engine printed: {"mix": "<file>", "stems": [...]}.
        std::string mix;
        const auto lines = splitLines(r.out);
        for (auto it = lines.rbegin(); it != lines.rend() && mix.empty(); ++it) {
            const auto m = json::parse(*it, nullptr, false);
            if (m.is_object()) mix = m.value("mix", "");
        }
        if (mix.empty()) {
            cleanup();
            throw std::runtime_error("could not read the engine's render manifest");
        }
        const fs::path dest = paths::fromUtf8(out);
        fs::create_directories(dest.parent_path(), ec);
        fs::copy_file(tmp / paths::fromUtf8(mix), dest, fs::copy_options::overwrite_existing, ec);
        cleanup();
        if (ec) throw std::runtime_error("could not write the render: " + ec.message());
        // Named as a FILE, so the tunnel uploads it before the server reads this reply.
        emit({{"type", "rendered"}, {"file", out}});
    };

    return jobs;
}

}  // namespace st0
