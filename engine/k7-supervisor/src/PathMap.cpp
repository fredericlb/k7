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

namespace k7::tunnel {

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

#ifdef _WIN32
const char* const kSeps = "\\/";
#else
const char* const kSeps = "/";
#endif

/** `p` without the empty last element a trailing separator leaves, once lexically normal. */
fs::path normalised(const fs::path& p)
{
    fs::path n = p.lexically_normal();
    if (!n.has_filename() && n.has_relative_path()) n = n.parent_path();
    return n;
}

/** Whether `p` is `root` or below it, compared element by element, never as a string prefix. */
bool lexicallyInside(const fs::path& root, const fs::path& p)
{
    const fs::path a = normalised(root);
    const fs::path b = normalised(p);
    auto bi = b.begin();
    for (auto ai = a.begin(); ai != a.end(); ++ai, ++bi)
        if (bi == b.end() || *ai != *bi) return false;
    for (; bi != b.end(); ++bi)
        if (*bi == "..") return false;
    return true;
}

}  // namespace

bool safeSegment(const std::string& seg)
{
    // Dots and spaces alone are refused whole: Windows trims `.. ` to `..`, and `...` names nothing anywhere.
    if (seg.find_first_not_of(". ") == std::string::npos) return false;
    for (const unsigned char c : seg)
        if (c < 0x20 || c == 0x7f || c == '/' || c == '\\' || c == ':') return false;
#ifdef _WIN32
    if (seg.back() == '.' || seg.back() == ' ') return false;
#endif
    return true;
}

std::optional<std::string> joinUnder(const std::string& localRoot, const std::string& rest)
{
    const fs::path root = paths::fromUtf8(localRoot);
    fs::path out = root;
    for (size_t start = 0;;) {
        const size_t slash = rest.find('/', start);
        const std::string seg = rest.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (!safeSegment(seg)) return std::nullopt;
        out /= paths::fromUtf8(seg);
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    if (!lexicallyInside(root, out)) return std::nullopt;
    return paths::utf8(out);
}

std::optional<std::string> relativeUnder(const std::string& localRoot, const std::string& local)
{
    if (local == localRoot) return std::string();
    const std::string prefix = localRoot + kSep;
    if (local.rfind(prefix, 0) != 0) return std::nullopt;
    std::string rel;
    for (size_t start = prefix.size();;) {
        const size_t end = local.find_first_of(kSeps, start);
        const std::string seg = local.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (!safeSegment(seg)) return std::nullopt;
        if (!rel.empty()) rel += '/';
        rel += seg;
        if (end == std::string::npos) break;
        start = end + 1;
    }
    if (!lexicallyInside(paths::fromUtf8(localRoot), paths::fromUtf8(local))) return std::nullopt;
    return rel;
}

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

std::optional<std::string> SyncLedger::redirect(const std::string& canonical)
{
    std::lock_guard lock(mutex_);
    auto it = redirects_.find(canonical);
    if (it == redirects_.end()) return std::nullopt;
    return it->second;
}

std::optional<std::string> SyncLedger::canonicalOf(const std::string& actual)
{
    std::lock_guard lock(mutex_);
    for (const auto& [canonical, at] : redirects_)
        if (at == actual) return canonical;
    return std::nullopt;
}

std::optional<std::string> SyncLedger::place(const std::string& canonical, const std::string& actual)
{
    std::lock_guard lock(mutex_);
    std::optional<std::string> before;
    if (auto it = redirects_.find(canonical); it != redirects_.end()) before = it->second;
    if (actual == canonical)
        redirects_.erase(canonical);
    else
        redirects_[canonical] = actual;
    return before;
}

namespace {

/** `clip.wav` → `clip~<server mtime>.wav`: one name per version, so a version placed once is found again after a restart. */
std::string beside(const std::string& local, double remoteMtime)
{
    const fs::path p = paths::fromUtf8(local);
    fs::path name = p.stem();
    name += paths::fromUtf8("~" + std::to_string(static_cast<long long>(remoteMtime)));
    name += p.extension();
    return paths::utf8(p.parent_path() / name);
}

}  // namespace

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
    auto c = canonical(remote);
    if (c)
        if (auto r = ledger_.redirect(*c)) return r;
    return c;
}

std::string PathMap::actual(const std::string& canonical) const { return ledger_.redirect(canonical).value_or(canonical); }

void PathMap::place(const std::string& canonical, const std::string& actual)
{
    const auto before = ledger_.place(canonical, actual);
    // The copy it replaces is removed when nothing holds it any more; one still held stays until a later try.
    if (before && *before != actual) {
        std::error_code ec;
        fs::remove(paths::fromUtf8(*before), ec);
    }
}

std::optional<std::string> PathMap::canonical(const std::string& remote) const
{
    for (const auto& r : roots_) {
        if (remote == r.remote) return r.local;
        const std::string prefix = r.remote + "/";
        if (remote.rfind(prefix, 0) != 0) continue;
        return joinUnder(r.local, remote.substr(prefix.size()));
    }
    return std::nullopt;
}

std::optional<std::pair<std::string, const MappedRoot*>> PathMap::toRemote(const std::string& named) const
{
    // A version placed beside a held file stands for the canonical path, which is what the server knows.
    const std::string local = ledger_.canonicalOf(named).value_or(named);
    for (const auto& r : roots_) {
        const auto rel = relativeUnder(r.local, local);
        if (!rel) continue;
        return std::make_pair(rel->empty() ? r.remote : r.remote + "/" + *rel, &r);
    }
    return std::nullopt;
}

bool PathMap::ensureLocal(const std::string& local)
{
    const auto mapped = toRemote(local);
    if (!mapped) return false;
    const auto entries = files_.stat({mapped->first});
    if (entries.empty() || entries.front().kind != "file") return false;
    ensureFile(entries.front(), ledger_.canonicalOf(local).value_or(local));
    return true;
}

std::string PathMap::outbound(const std::string& text, bool fetch)
{
    bool hit = false;
    for (const auto& n : remoteNeedles_) hit = hit || text.find(n) != std::string::npos;
    if (!hit) return text;
    auto msg = ojson::parse(text, nullptr, false);
    if (msg.is_discarded()) return text;
    const std::string type = msg.is_object() && msg.contains("type") && msg["type"].is_string() ? msg["type"].get<std::string>() : "";
    if (kUnmappedTypes.count(type)) return text;
    // A `sync` request names the files it is about to copy itself, reporting as it goes.
    if (fetch && type != "sync") {
        std::set<std::string> named;
        collect(msg, [this](const std::string& s) { return canonical(s).has_value(); }, named);
        // A whole document is checked against the server; a delta trusts what an earlier one settled.
        const bool recheck = type == "project";
        std::vector<std::string> ask;
        for (const auto& p : named)
            if (recheck || !ledger_.get(*canonical(p))) ask.push_back(p);
        if (!ask.empty()) {
            log_("checking " + std::to_string(ask.size()) + " file(s) before a '" + type + "' frame");
            bringDown(files_.stat(ask));
        }
    }
    return mapStrings(msg, [this](const std::string& s) { return toLocal(s); }).dump();
}

SyncProgress PathMap::sync(const std::vector<std::string>& locals, const std::function<void(const SyncProgress&)>& progress)
{
    std::vector<std::string> ask;
    for (const auto& l : locals)
        if (auto m = toRemote(l)) ask.push_back(m->first);
    SyncProgress p;
    std::vector<RemoteStat> todo;
    if (!ask.empty())
        for (const auto& e : files_.stat(ask)) {
            const auto local = canonical(e.path);
            if (!local) continue;
            std::error_code ec;
            if (e.kind == "dir")
                fs::create_directories(paths::fromUtf8(*local), ec);
            else if (e.kind == "missing")
                fs::create_directories(paths::fromUtf8(*local).parent_path(), ec);
            else if (!upToDate(e, *local)) {
                todo.push_back(e);
                p.bytes += e.size.value_or(0);
            }
        }
    p.files = todo.size();
    progress(p);
    std::mutex m;
    constexpr size_t kParallel = 8;
    std::atomic<size_t> next{0};
    auto worker = [&] {
        for (size_t i = next++; i < todo.size(); i = next++) {
            const auto& e = todo[i];
            std::string failure;
            try {
                ensureFile(e, *canonical(e.path));
            } catch (const std::exception& err) {
                log_("could not bring down " + e.path + ": " + err.what());
                failure = e.path.substr(e.path.find_last_of('/') + 1) + " — " + err.what();
            }
            std::lock_guard lock(m);
            ++p.filesDone;
            p.bytesDone += e.size.value_or(0);
            if (!failure.empty()) p.failures.push_back(failure);
            progress(p);
        }
    };
    std::vector<std::thread> pool;
    for (size_t i = 0; i < std::min(kParallel, todo.size()); ++i) pool.emplace_back(worker);
    for (auto& t : pool) t.join();
    return p;
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
            const auto local = canonical(e.path);
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

bool PathMap::upToDate(const RemoteStat& e, const std::string& local)
{
    const auto size = e.size.value_or(0);
    const double remoteMtime = e.mtimeMs.value_or(0);
    const auto have = filetime::stat(paths::fromUtf8(actual(local)));
    const auto known = ledger_.get(local);
    const bool same =
        known ? known->size == size && filetime::same(known->remoteMtimeMs, remoteMtime) && have && have->size == size &&
                    filetime::same(have->mtimeMs, known->localMtimeMs)
              : have && have->size == size && filetime::same(have->mtimeMs, remoteMtime);
    if (same && !known && have) ledger_.set(local, {size, have->mtimeMs, remoteMtime});
    return same;
}

void PathMap::ensureFile(const RemoteStat& e, const std::string& local)
{
    const auto size = e.size.value_or(0);
    const double remoteMtime = e.mtimeMs.value_or(0);
    const fs::path p = paths::fromUtf8(local);
    if (upToDate(e, local)) return;
    const std::string aside = beside(local, remoteMtime);
    // A version already placed beside a held file — before a restart, say — is adopted rather than fetched again.
    if (const auto there = filetime::stat(paths::fromUtf8(aside)); there && there->size == size && filetime::same(there->mtimeMs, remoteMtime)) {
        place(local, aside);
        ledger_.set(local, {size, there->mtimeMs, remoteMtime});
        return;
    }
    ledger_.downloadOnce(local, [&] {
        log_("fetching " + e.path + " (" + std::to_string(size) + " bytes)");
        try {
            files_.download(e, p);
            place(local, local);
        } catch (const TargetInUse& held) {
            // The engine holds the old version open: the new one goes beside it, and frames name that.
            std::error_code ec;
            fs::rename(held.part, paths::fromUtf8(aside), ec);
            if (ec) {
                fs::remove(held.part, ec);
                throw std::runtime_error(std::string(held.what()) + ", and the new version could not be put beside it");
            }
            filetime::setMtimeMs(paths::fromUtf8(aside), remoteMtime);
            log_(local + " is held open; its new version is " + aside);
            place(local, aside);
        }
    });
    if (const auto now = filetime::stat(paths::fromUtf8(actual(local)))) ledger_.set(local, {now->size, now->mtimeMs, remoteMtime});
}

void PathMap::sendUp(const std::string& named)
{
    const auto mapped = toRemote(named);
    if (!mapped || !mapped->second->writable) return;
    const auto have = filetime::stat(paths::fromUtf8(named));
    if (!have || !have->isFile) return;
    // The ledger is keyed by the canonical path, which a version placed beside a held file stands for.
    const std::string local = ledger_.canonicalOf(named).value_or(named);
    const auto known = ledger_.get(local);
    if (known && known->size == have->size && filetime::same(known->localMtimeMs, have->mtimeMs)) return;
    try {
        log_("sending " + mapped->first + " (" + std::to_string(have->size) + " bytes)");
        const auto back = files_.upload(paths::fromUtf8(named), mapped->first);
        ledger_.set(local, {have->size, have->mtimeMs, back.mtimeMs.value_or(0)});
    } catch (const std::exception& err) {
        log_("could not send " + local + ": " + err.what());
    }
}

}  // namespace k7::tunnel
