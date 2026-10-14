// TunnelFiles.cpp — see TunnelFiles.h.

#include "TunnelFiles.h"

#include "FileTime.h"
#include "Paths.h"
#include "TunnelFrames.h"

#include <chrono>
#include <stdexcept>
#include <thread>

namespace k7::tunnel {

namespace fs = std::filesystem;

RemoteStat remoteStatFrom(const nlohmann::json& j)
{
    RemoteStat s;
    s.path = j.value("path", "");
    s.kind = j.value("kind", "missing");
    if (auto it = j.find("size"); it != j.end() && it->is_number()) s.size = it->get<std::uint64_t>();
    if (auto it = j.find("mtimeMs"); it != j.end() && it->is_number()) s.mtimeMs = it->get<double>();
    return s;
}

RemoteFiles FileRequests::forChannel(int ch)
{
    return {
        [this, ch](const std::vector<std::string>& paths) { return stat(ch, paths); },
        [this, ch](const RemoteStat& remote, const fs::path& local) { download(ch, remote, local); },
        [this, ch](const fs::path& local, const std::string& remote) { return upload(ch, local, remote); },
    };
}

std::vector<RemoteStat> FileRequests::stat(int ch, const std::vector<std::string>& paths)
{
    std::future<std::vector<RemoteStat>> reply;
    int req;
    {
        std::lock_guard lock(mutex_);
        req = nextReq_++;
        reply = stats_[req].get_future();
    }
    if (!link_.sendText(nlohmann::json{{"t", "stat"}, {"req", req}, {"ch", ch}, {"paths", paths}}.dump())) {
        std::lock_guard lock(mutex_);
        stats_.erase(req);
        throw std::runtime_error("tunnel is down");
    }
    return reply.get();
}

void FileRequests::download(int ch, const RemoteStat& remote, const fs::path& local)
{
    std::error_code ec;
    fs::create_directories(local.parent_path(), ec);
    int req;
    auto d = std::make_shared<Download>();
    std::future<void> done = d->done.get_future();
    fs::path tmp;
    {
        std::lock_guard lock(mutex_);
        req = nextReq_++;
        tmp = local;
        tmp += ".part-" + std::to_string(req);
        d->out.open(tmp, std::ios::binary | std::ios::trunc);
        if (!d->out) throw std::runtime_error("cannot write " + paths::utf8(tmp));
        gets_[req] = d;
    }
    try {
        if (!link_.sendText(nlohmann::json{{"t", "get"}, {"req", req}, {"ch", ch}, {"path", remote.path}}.dump()))
            throw std::runtime_error("tunnel is down");
        done.get();
    } catch (...) {
        {
            std::lock_guard lock(mutex_);
            gets_.erase(req);
        }
        d->out.close();
        fs::remove(tmp, ec);
        throw;
    }
    fs::rename(tmp, local, ec);
    if (ec) {
        // Windows will not rename over an open or read-only file; replace it in two steps instead.
        std::error_code removed;
        fs::remove(local, removed);
        fs::rename(tmp, local, ec);
        // Still refused: the target is held open, so the complete file goes back to the caller to place.
        if (ec) throw TargetInUse(paths::utf8(local) + " is in use: " + ec.message(), tmp);
    }
    filetime::setMtimeMs(local, remote.mtimeMs.value_or(0));
}

RemoteStat FileRequests::upload(int ch, const fs::path& local, const std::string& remote)
{
    std::future<RemoteStat> reply;
    int req;
    {
        std::lock_guard lock(mutex_);
        req = nextReq_++;
        reply = puts_[req].get_future();
    }
    auto send = [&](const std::string& chunk, bool last) {
        // Backpressure: never queue a whole take in memory behind a slow link.
        while (link_.isOpen() && link_.buffered() > kHighWaterBytes) std::this_thread::sleep_for(std::chrono::milliseconds(5));
        const nlohmann::json head = {{"t", "put"}, {"req", req}, {"ch", ch}, {"path", remote}, {"last", last}};
        if (!link_.sendBinary(encodeBinary(head, chunk))) throw std::runtime_error("tunnel is down");
    };
    try {
        std::ifstream in(local, std::ios::binary);
        if (!in) throw std::runtime_error("cannot read " + paths::utf8(local));
        const auto size = fs::file_size(local);
        if (size == 0) {
            send({}, true);
        } else {
            std::string buf(kChunkBytes, '\0');
            std::uint64_t sent = 0;
            while (sent < size) {
                in.read(buf.data(), static_cast<std::streamsize>(buf.size()));
                const auto n = static_cast<size_t>(in.gcount());
                if (n == 0) break;
                sent += n;
                send(buf.substr(0, n), sent >= size);
            }
            if (sent < size) send({}, true);
        }
    } catch (...) {
        std::lock_guard lock(mutex_);
        puts_.erase(req);
        throw;
    }
    return reply.get();
}

void FileRequests::onStatReply(int req, const nlohmann::json& entries)
{
    std::lock_guard lock(mutex_);
    auto it = stats_.find(req);
    if (it == stats_.end()) return;
    std::vector<RemoteStat> out;
    if (entries.is_array())
        for (const auto& e : entries) out.push_back(remoteStatFrom(e));
    it->second.set_value(std::move(out));
    stats_.erase(it);
}

void FileRequests::onPutReply(int req, const nlohmann::json& stat, const std::string& error)
{
    std::lock_guard lock(mutex_);
    auto it = puts_.find(req);
    if (it == puts_.end()) return;
    if (stat.is_object())
        it->second.set_value(remoteStatFrom(stat));
    else
        it->second.set_exception(std::make_exception_ptr(std::runtime_error(error.empty() ? "upload refused" : error)));
    puts_.erase(it);
}

void FileRequests::onGetError(int req, const std::string& error)
{
    std::shared_ptr<Download> d;
    {
        std::lock_guard lock(mutex_);
        auto it = gets_.find(req);
        if (it == gets_.end()) return;
        d = it->second;
        gets_.erase(it);
    }
    d->done.set_exception(std::make_exception_ptr(std::runtime_error(error)));
}

void FileRequests::onChunk(int req, bool last, const std::string& payload)
{
    std::shared_ptr<Download> d;
    {
        std::lock_guard lock(mutex_);
        auto it = gets_.find(req);
        if (it == gets_.end()) return;
        d = it->second;
        if (last) gets_.erase(it);
    }
    d->out.write(payload.data(), static_cast<std::streamsize>(payload.size()));
    if (!last) return;
    d->out.close();
    if (d->out.fail())
        d->done.set_exception(std::make_exception_ptr(std::runtime_error("write failed")));
    else
        d->done.set_value();
}

void FileRequests::failAll()
{
    std::lock_guard lock(mutex_);
    const auto gone = std::make_exception_ptr(std::runtime_error("tunnel dropped"));
    for (auto& [_, d] : gets_) d->done.set_exception(gone);
    for (auto& [_, p] : puts_) p.set_exception(gone);
    for (auto& [_, s] : stats_) s.set_value({});
    gets_.clear();
    puts_.clear();
    stats_.clear();
}

}  // namespace k7::tunnel
