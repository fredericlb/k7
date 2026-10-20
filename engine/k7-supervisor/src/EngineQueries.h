// EngineQueries.h — request/reply over ONE long-lived engine connection. Replies are typed by
// frame, not by request, so exactly one call is in flight: every call queues on a worker thread
// that owns the socket, waits for its typed reply or its deadline, and posts the answer back to the
// Loop. A timeout forces a redial rather than trusting a half-dead socket. See docs/supervisor.md.

#pragma once

#include "HostProtocol.h"
#include "Loop.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace k7 {

class EngineQueries {
public:
    template <class T>
    using Reply = std::function<void(std::optional<T>)>;

    EngineQueries(Loop& loop, int port);
    ~EngineQueries();

    /** Drop the connection (the engine stopped); the next call redials. */
    void close();

    /** The engine now serves on `port`: the next dial goes there. */
    void setPort(int port);

    /** The engine's `whoami` reply as it came — its protocol, build and safe mode; null means it did not answer. */
    void whoami(Reply<nlohmann::json> done);

    /** The interfaces the engine offers; null means it did not answer. */
    void listAudioDevices(Reply<std::vector<protocol::AudioDevice>> done);

    /** Switch interface; the engine answers with the same device list. */
    void setAudioDevice(const std::string& name, const std::string& deviceType, Reply<std::vector<protocol::AudioDevice>> done);

    /** The installed catalogue, and whether the engine is still scanning it, which means this list is about to change. */
    struct Catalogue {
        std::vector<protocol::Plugin> plugins;
        bool scanning = false;
    };

    /** The installed catalogue, sorted so a reordered scan is not a changed catalogue. */
    void listPlugins(Reply<Catalogue> done);

    /** The plugin INSTANCES across every session, each naming its own. */
    void listEditPlugins(Reply<std::vector<protocol::EditPlugin>> done);

    /** The projects the engine holds. */
    void listSessions(Reply<std::vector<protocol::Session>> done);

    /** Fire-and-forget: the sessions poll shows the result. */
    void dropSession(const std::string& session, std::function<void()> done);

    /** The LAN devices waiting for the musician's approval. */
    void listPairRequests(Reply<std::vector<protocol::PairRequest>> done);

    /** The LAN devices this engine has paired. */
    void listPairedDevices(Reply<std::vector<protocol::PairedDevice>> done);

    /** Fire-and-forget `pair-approve`, `pair-deny` (a requestId) or `unpair-device` (a deviceId); the pairing poll shows the result. */
    void pairVerb(const std::string& verb, const std::string& id, std::function<void()> done);

    /** Fire-and-forget: the engine acknowledges by drawing the window. */
    void showNativePluginUI(const std::string& id, const std::optional<std::string>& session, std::function<void()> done);

    /** Delete the scan cache — without that the rescan returns the stale list — then ask for a rescan. */
    void rescanPlugins(std::function<void()> done);

private:
    struct Worker;
    Loop& loop_;
    std::shared_ptr<Worker> worker_;
};

}  // namespace k7
