// ServeContext.h — what every message handler of the server shares: the host, the two broadcast verbs,
// who listens to and drives what, and the detached work serve() waits for. JUCE-free, like Serve.cpp.
// The one thing a reader would get wrong: it lives in serve()'s frame, so anything that outlives serve() must not hold it.

#pragma once

#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <condition_variable>
#include <functional>
#include <initializer_list>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <EngineHost.h>

#include "../engine/Warnings.h"   // warn() — a failed background job has to reach the client
#include "Pairing.h"

namespace studio {

class AudioSender;

// The detached threads a message starts, COUNTED so serve() can wait for them: each captures serve()'s frame by reference (docs/audit-stabilite.md).
struct DetachedWork {
    std::mutex m;
    std::condition_variable idle;
    int running = 0;

    template <typename F>
    void spawn(F fn) {
        {
            std::lock_guard<std::mutex> lk(m);
            ++running;
        }
        std::thread([this, fn = std::move(fn)]() mutable {
            // An exception leaving a std::thread is std::terminate, and this work loads plugins and parses what clients send.
            try {
                fn();
            } catch (const std::exception& e) {
                warn(std::string("background work failed: ") + e.what());
            } catch (...) {
                warn("background work failed (unknown exception)");
            }
            std::lock_guard<std::mutex> lk(m);
            if (--running == 0) idle.notify_all();
        }).detach();
    }

    // True when every one has finished inside `limit`.
    bool waitIdle(std::chrono::milliseconds limit) {
        std::unique_lock<std::mutex> lk(m);
        return idle.wait_for(lk, limit, [this] { return running == 0; });
    }
};

struct ServeContext {
    EngineHost& host;
    DetachedWork& work;
    std::string engineId;
    std::string engineToken;
    // This PROCESS, where engineId is the machine's: a reconnect that answers another one met a restarted engine.
    std::string bootId;
    // Nobody hears this machine's device, so a client should play the broadcast instead (docs/broadcast.md); set by env at boot.
    bool audioToBrowser = false;

    // Every connected client — for the MACHINE's replies only; a project's go through broadcastTo (docs/protocol.md).
    std::function<void(const nlohmann::json&)> broadcast;
    // The same, stamped with the project it is about — two verbs, so a new reply must CHOOSE one in a reviewable word.
    std::function<void(const std::string&, nlohmann::json)> broadcastTo;

    // Guards the three maps below; IXWebSocket runs each connection's callback on its own thread.
    std::mutex listenersMx;
    // Who asked for audio, by POINTER matched against server.getClients(): the stream must never reach a connection that did not ask.
    std::unordered_map<const ix::WebSocket*, std::string> listeners;
    // Which sockets DRIVE a session, declared on hello with `{"role":"driver"}`, at most one session each (docs/sessions.md).
    std::unordered_map<const ix::WebSocket*, std::string> drivers;
    // WHICH project each socket is about, bound ONCE from its first real message, so a state frame reaches only those (docs/protocol.md).
    std::unordered_map<const ix::WebSocket*, std::string> subscribers;

    // The audio stream's sender, set once serve() has built it.
    AudioSender* audio = nullptr;

    // Who may drive: a loopback peer always, a LAN peer once paired (docs/pairing.md); its own lock, since a broadcast reads it from any thread.
    Pairing* pairing = nullptr;
    std::mutex trustMx;
    std::unordered_set<const ix::WebSocket*> trusted;
    std::unordered_set<const ix::WebSocket*> local;   // …and the loopback ones among them
    std::unordered_set<const ix::WebSocket*> refused;   // …and the pages from a site not allowed, closing
    std::vector<std::string> allowedOrigins;   // `STUDIO_ENGINE_ALLOWED_ORIGINS`, beside the built-in ones
    bool isTrusted(const ix::WebSocket* ws) {
        std::lock_guard<std::mutex> lk(trustMx);
        return trusted.count(ws) != 0;
    }
    // One socket by pointer, if it is still connected: the requester an approval answers.
    std::function<void(const ix::WebSocket*, const nlohmann::json&)> sendTo;
    std::function<void(const ix::WebSocket*)> closeSocket;
    // The machine's own clients only: what a pairing request carries is for the musician's eyes.
    std::function<void(const nlohmann::json&)> broadcastLocal;
};

// Before even that, the handshake's Origin: true when the socket is a refused page's and the message goes nowhere.
bool screenOrigin(ServeContext&, ix::WebSocket&, const ix::WebSocketMessagePtr&);
// …and before the parse: true when a peer not yet trusted sent a frame larger than any of its verbs, refused unread.
bool screenFrameSize(ServeContext&, ix::WebSocket&, const std::string& peerIp, size_t bytes);
// Every message passes here first: true when it was answered — a pairing verb, or a refusal — and must go no further (docs/pairing.md).
bool screenMessage(ServeContext&, ix::WebSocket&, const std::string& peerIp, const nlohmann::json&,
                   const std::string& type);
// A socket closed: its trust, its pending request and its device binding go.
void forgetSocket(ServeContext&, const ix::WebSocket*);

// One message kind's answer: the socket it came on, the parsed message, its session and its type.
using Handler = std::function<void(ServeContext&, ix::WebSocket&, const nlohmann::json&,
                                   const std::string& session, const std::string& type)>;

class HandlerTable {
public:
    void add(std::initializer_list<const char*> types, Handler h) {
        for (const char* t : types) table_[t] = h;
    }
    const Handler* find(const std::string& type) const {
        const auto it = table_.find(type);
        return it == table_.end() ? nullptr : &it->second;
    }

private:
    std::map<std::string, Handler> table_;
};

// The handlers, by concern — docs/protocol.md is the catalogue.
void addProjectHandlers(HandlerTable&);
void addPluginHandlers(HandlerTable&);
void addMachineHandlers(HandlerTable&);

// One serialized plugin scan for the whole process; a warm cache short-circuits unless `force`.
std::vector<PluginInfo> ensurePluginsScanned(bool force);

}  // namespace studio
