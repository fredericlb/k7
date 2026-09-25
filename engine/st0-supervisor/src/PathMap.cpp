// PathMap.cpp — see PathMap.h. Documents are rewritten through `ordered_json`, so a frame keeps its
// key order across the machine and a diff of two logs stays readable.

#include "PathMap.h"

#include "FileTime.h"
#include "Paths.h"

#include <algorithm>
#include <atomic>
#include <future>
#include <set>
#include <thread>

namespace st0::tunnel {

namespace fs = std::filesystem;
using ojson = nlohmann::ordered_json;

namespace {

/** Frames arriving at meter rate carry no path, and are passed through untouched. */
const std::set<std::string> kUnmappedTypes = {"state", "io-levels", "levels"};

/** A string as it appears inside a JSON document, quotes stripped: what a raw-text search must look for. */
std::string jsonEscaped(const std::string& s)
{
    const std::string q = nlohmann::json(s).dump();
    return q.substr(1, q.size() - 2);
}

template <class F>
ojson mapStrings(const ojson& v, const F& f)
{
    if (v.is_string()) {
        if (auto m = f(v.get<std::string>())) return *m;
        return v;
    }
    if (v.is_array()) {
        ojson out = ojson::array();
        for (const auto& x : v) out.push_back(mapStrings(x, f));
        return out;
    }
    if (v.is_object()) {
        ojson out = ojson::object();
        for (auto it = v.begin(); it != v.end(); ++it) out[it.key()] = mapStrings(it.value(), f);
        return out;
    }
    return v;
}

template <class F>
void collect(const ojson& v, const F& keep, std::set<std::string>& into)
{
    if (v.is_string()) {
        if (keep(v.get<std::string>())) into.insert(v.get<std::string>());
    } else if (v.is_structured()) {
        for (const auto& x : v) collect(x, keep, into);
    }
}

const char kSep = static_cast<char>(fs::path::preferred_separator);

}  // namespace

std::optional<SyncLedger::Synced> SyncLedger::get(const std::string& local)
{
    std::lock_guard lock(mutex_);
    auto it = synced_.find(local);
    if (it == synced_.end()) return std::nullopt;
    return it->second;
}

void SyncLedger::set(const std::string& local, Synced s)
{
    std::lock_guard lock(mutex_);
    synced_[local] = s;
}

void SyncLedger::downloadOnce(const std::string& local, const std::function<void()>& fetch)
{
    std::shared_future<void> pending;
    std::promise<void> mine;
    bool ours = false;
    {
        std::lock_guard lock(mutex_);
        auto it = downloads_.find(local);
        if (it != downloads_.end()) {
            pending = it->second;
        } else {
            pending = mine.get_future().share();
            downloads_[local] = pending;
            ours = true;
        }
    }
    if (ours) {
        try {
            fetch();
            mine.set_value();
        } catch (...) {
            mine.set_exception(std::current_exception());
        }
        std::lock_guard lock(mutex_);
        downloads_.erase(local);
    }
    pending.get();
}

PathMap::PathMap(std::vector<MappedRoot> roots, RemoteFiles files, SyncLedger& ledger,
                 std::function<void(const std::string&)> log)
    : roots_(std::move(roots)), files_(std::move(files)), ledger_(ledger), log_(std::move(log))
{
    for (const auto& r : roots_) {
        remoteNeedles_.push_back(jsonEscaped(r.remote));
        localNeedles_.push_back(jsonEscaped(r.local));
    }
}

std::optional<std::string> PathMap::toLocal(const std::string& remote) const
{
    for (const auto& r : roots_) {
        if (remote == r.remote) return r.local;
        const std::string prefix = r.remote + "/";
        if (remote.rfind(prefix, 0) != 0) continue;
        fs::path out = paths::fromUtf8(r.local);
        std::string rest = remote.substr(prefix.size());
        for (size_t start = 0;;) {
            const size_t slash = rest.find('/', start);
            const std::string seg = rest.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
            // A path that climbs, or an empty segment, is refused rather than resolved.
            if (seg.empty() || seg == "..") return std::nullopt;
            out /= paths::fromUtf8(seg);
            if (slash == std::string::npos) break;
            start = slash + 1;
        }
        return paths::utf8(out);
    }
    return std::nullopt;
}

std::optional<std::pair<std::string, const MappedRoot*>> PathMap::toRemote(const std::string& local) const
{
    for (const auto& r : roots_) {
        if (local == r.local) return std::make_pair(r.remote, &r);
        const std::string prefix = r.local + kSep;
        if (local.rfind(prefix, 0) != 0) continue;
        std::string rel = local.substr(prefix.size());
        if (rel.empty() || rel.rfind("..", 0) == 0) continue;
        for (char& c : rel)
            if (c == kSep) c = '/';
        return std::make_pair(r.remote + "/" + rel, &r);
    }
    return std::nullopt;
}

bool PathMap::ensureLocal(const std::string& local)
{
    const auto mapped = toRemote(local);
    if (!mapped) return false;
    const auto entries = files_.stat({mapped->first});
    if (entries.empty() || entries.front().kind != "file") return false;
    ensureFile(entries.front(), local);
    return true;
}

std::string PathMap::outbound(const std::string& text)
{
    bool hit = false;
    for (const auto& n : remoteNeedles_) hit = hit || text.find(n) != std::string::npos;
    if (!hit) return text;
    auto msg = ojson::parse(text, nullptr, false);
    if (msg.is_discarded()) return text;
    const std::string type = msg.is_object() && msg.contains("type") && msg["type"].is_string() ? msg["type"].get<std::string>() : "";
    if (kUnmappedTypes.count(type)) return text;
    std::set<std::string> named;
    collect(msg, [this](const std::string& s) { return toLocal(s).has_value(); }, named);
    // A whole document is checked against the server; a delta trusts what an earlier one settled.
    const bool recheck = type == "project";
    std::vector<std::string> ask;
    for (const auto& p : named)
        if (recheck || !ledger_.get(*toLocal(p))) ask.push_back(p);
    if (!ask.empty()) bringDown(files_.stat(ask));
    return mapStrings(msg, [this](const std::string& s) { return toLocal(s); }).dump();
}

std::string PathMap::inbound(const std::string& text)
{
    bool hit = false;
    for (const auto& n : localNeedles_) hit = hit || text.find(n) != std::string::npos;
    if (!hit) return text;
    auto msg = ojson::parse(text, nullptr, false);
    if (msg.is_discarded()) return text;
    // A reply's `raw` is delivered as the machine wrote it: its caller needs the machine's own spelling.
    std::optional<ojson> raw;
    if (msg.is_object() && msg.contains("raw")) {
        raw = msg["raw"];
        msg.erase("raw");
    }
    std::set<std::string> named;
    collect(msg, [this](const std::string& s) { return toRemote(s).has_value(); }, named);
    for (const auto& local : named) sendUp(local);
    auto mapped = mapStrings(msg, [this](const std::string& s) -> std::optional<std::string> {
        if (auto m = toRemote(s)) return m->first;
        return std::nullopt;
    });
    if (raw) mapped["raw"] = *raw;
    return mapped.dump();
}

void PathMap::bringDown(const std::vector<RemoteStat>& entries)
{
    // A few at once, not one per file: a project can name hundreds, and each download is a request in flight.
    constexpr size_t kParallel = 8;
    std::atomic<size_t> next{0};
    auto worker = [&] {
        for (size_t i = next++; i < entries.size(); i = next++) {
            const auto& e = entries[i];
            const auto local = toLocal(e.path);
            if (!local) continue;
            try {
                std::error_code ec;
                if (e.kind == "dir")
                    fs::create_directories(paths::fromUtf8(*local), ec);
                else if (e.kind == "missing")
                    fs::create_directories(paths::fromUtf8(*local).parent_path(), ec);
                else
                    ensureFile(e, *local);
            } catch (const std::exception& err) {
                log_("could not bring down " + e.path + ": " + err.what());
            }
        }
    };
    std::vector<std::thread> pool;
    for (size_t i = 0; i < std::min(kParallel, entries.size()); ++i) pool.emplace_back(worker);
    for (auto& t : pool) t.join();
}

void PathMap::ensureFile(const RemoteStat& e, const std::string& local)
{
    const auto size = e.size.value_or(0);
    const double remoteMtime = e.mtimeMs.value_or(0);
    const fs::path p = paths::fromUtf8(local);
    const auto have = filetime::stat(p);
    const auto known = ledger_.get(local);
    const bool upToDate =
        known ? known->size == size && filetime::same(known->remoteMtimeMs, remoteMtime) && have && have->size == size &&
                    filetime::same(have->mtimeMs, known->localMtimeMs)
              : have && have->size == size && filetime::same(have->mtimeMs, remoteMtime);
    if (upToDate) {
        if (!known && have) ledger_.set(local, {size, have->mtimeMs, remoteMtime});
        return;
    }
    ledger_.downloadOnce(local, [&] {
        log_("fetching " + e.path + " (" + std::to_string(size) + " bytes)");
        files_.download(e, p);
    });
    if (const auto now = filetime::stat(p)) ledger_.set(local, {now->size, now->mtimeMs, remoteMtime});
}

void PathMap::sendUp(const std::string& local)
{
    const auto mapped = toRemote(local);
    if (!mapped || !mapped->second->writable) return;
    const auto have = filetime::stat(paths::fromUtf8(local));
    if (!have || !have->isFile) return;
    const auto known = ledger_.get(local);
    if (known && known->size == have->size && filetime::same(known->localMtimeMs, have->mtimeMs)) return;
    try {
        log_("sending " + mapped->first + " (" + std::to_string(have->size) + " bytes)");
        const auto back = files_.upload(paths::fromUtf8(local), mapped->first);
        ledger_.set(local, {have->size, have->mtimeMs, back.mtimeMs.value_or(0)});
    } catch (const std::exception& err) {
        log_("could not send " + local + ": " + err.what());
    }
}

}  // namespace st0::tunnel
