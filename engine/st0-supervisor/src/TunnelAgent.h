// TunnelAgent.h — the ENGINE machine's end of the tunnel: one outbound socket to the server that lists
// the engine, and for every channel the server opens, either a real socket to the local engine or
// a jobs channel this agent answers itself. Frames cross in order, one queue per direction, so a
// frame waiting on a download is never overtaken. The socket's own thread never blocks: queues and
// job threads wait instead. The twin of engine-tunnel/agent.ts. See docs/supervisor.md.

#pragma once

#include <nlohmann/json.hpp>

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>

namespace st0::tunnel {

/** What a handler may ask of its channel beyond replying. */
struct JobContext {
    /** Bring one file down by its LOCAL path, when a request names too many to fetch before it starts. */
    std::function<bool(const std::string& local)> fetch;
};

/** Send one reply; any path in it goes back through the channel's map. */
using Emit = std::function<void(const nlohmann::ordered_json& reply)>;

/** Answer one request, as often as it has news; runs on a thread of its own, and may throw. */
using JobHandler = std::function<void(const nlohmann::json& req, const Emit& emit, JobContext& ctx)>;

using Jobs = std::map<std::string, JobHandler>;

struct AgentOptions {
    /** The registry's base URL; the tunnel is `/api/engine-tunnel` under it. */
    std::string registryUrl;
    std::string id;
    std::string token;
    int enginePort = 8765;
    /** Where this server's files are kept on this machine. */
    std::filesystem::path cacheDir;
    Jobs jobs;
    /** Answer a WebRTC offer with an SDP answer; throws when this machine cannot. Empty: no WebRTC. */
    std::function<std::string(const std::string& offer)> answerOffer;
    std::function<void(const std::string&)> log;
};

class TunnelAgent {
public:
    static std::shared_ptr<TunnelAgent> create(AgentOptions opts);
    ~TunnelAgent();

    /** Dial, and keep redialling with backoff until `stop`. */
    void start();

    /** Let go: returns at once, the connection thread finishing on its own. */
    void stop();

    /** Whether the hub accepted us last time. */
    bool connected() const;

private:
    explicit TunnelAgent(AgentOptions opts);
    struct Impl;
    std::shared_ptr<Impl> impl_;
};

}  // namespace st0::tunnel
