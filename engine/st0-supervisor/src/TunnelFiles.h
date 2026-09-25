// TunnelFiles.h — the agent's requests to the hub for a channel's files: stat, download, upload. A
// download lands beside its target and is renamed over it, stamped with the server's mtime; the
// replies arrive on the socket's thread and wake the caller waiting on its request id. A dropped
// tunnel fails every request in flight. The twin of engine-tunnel/agentFiles.ts.

#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace st0::tunnel {

struct RemoteStat {
    std::string path;
    std::string kind;  // "file" | "dir" | "missing"
    std::optional<std::uint64_t> size;
    std::optional<double> mtimeMs;
};

RemoteStat remoteStatFrom(const nlohmann::json& j);

/** The socket as the requests need it; implemented by the agent. */
struct HubLink {
    virtual ~HubLink() = default;
    virtual bool sendText(const std::string& text) = 0;
    virtual bool sendBinary(const std::string& bytes) = 0;
    virtual size_t buffered() = 0;
    virtual bool isOpen() = 0;
};

/** What the path map asks of one channel's files. */
struct RemoteFiles {
    std::function<std::vector<RemoteStat>(const std::vector<std::string>&)> stat;
    std::function<void(const RemoteStat&, const std::filesystem::path&)> download;
    std::function<RemoteStat(const std::filesystem::path&, const std::string&)> upload;
};

class FileRequests {
public:
    explicit FileRequests(HubLink& link) : link_(link) {}

    /** A RemoteFiles bound to one channel, whose roots the hub checks every path against. */
    RemoteFiles forChannel(int ch);

    void onStatReply(int req, const nlohmann::json& entries);
    void onPutReply(int req, const nlohmann::json& stat, const std::string& error);
    void onGetError(int req, const std::string& error);
    /** Written in arrival order, on the socket's thread. */
    void onChunk(int req, bool last, const std::string& payload);

    /** The tunnel dropped: nothing in flight will ever be answered. */
    void failAll();

private:
    struct Download {
        std::ofstream out;
        std::promise<void> done;
    };

    std::vector<RemoteStat> stat(int ch, const std::vector<std::string>& paths);
    void download(int ch, const RemoteStat& remote, const std::filesystem::path& local);
    RemoteStat upload(int ch, const std::filesystem::path& local, const std::string& remote);

    HubLink& link_;
    std::mutex mutex_;
    int nextReq_ = 1;
    std::map<int, std::promise<std::vector<RemoteStat>>> stats_;
    std::map<int, std::promise<RemoteStat>> puts_;
    std::map<int, std::shared_ptr<Download>> gets_;
};

}  // namespace st0::tunnel
