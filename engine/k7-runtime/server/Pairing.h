// Pairing.h — which LAN devices may drive this engine: the keys the paired ones hold, the requests waiting
// for the musician, and which live sockets they speak for. A loopback peer needs none of it.
// The one thing a reader would get wrong: relayed traffic (the tunnel, WebRTC) arrives from loopback too,
// already authenticated by the server, so "local" is decided by the peer address alone. docs/pairing.md.

#pragma once

#include <chrono>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ix {
class WebSocket;
}

namespace studio {

/** A peer address the machine itself owns: 127.0.0.0/8, ::1, and the v4-mapped form of either. */
bool isLoopbackAddress(const std::string& ip);

/** Whether a socket whose handshake carries `Origin: origin` may be served: loopback, st0.app, or one of `extra` — docs/pairing.md. */
bool originAllowed(const std::string& origin, const std::vector<std::string>& extra);

/** `STUDIO_ENGINE_ALLOWED_ORIGINS`: comma-separated origins, trimmed, lower-cased, a trailing slash dropped. */
std::vector<std::string> parseOrigins(const std::string& list);

class Pairing {
public:
    struct Request {
        std::string id, name, ip, code;
        long long createdMs = 0;
    };
    struct Device {
        std::string id, name;
        long long createdMs = 0, lastSeenMs = 0;
    };

    /** The store at `file`, read now; a missing or unreadable file is no device paired. */
    explicit Pairing(std::string file);

    /** A new request from `from`, replacing any it already had; nullopt when too many are pending. */
    std::optional<Request> request(const std::string& name, const std::string& ip, const ix::WebSocket* from);

    /** Approve: the device made, its key, and the socket that asked — nullopt for a request gone or expired. */
    struct Approved {
        Device device;
        std::string key;
        const ix::WebSocket* from = nullptr;
    };
    std::optional<Approved> approve(const std::string& requestId);

    /** Deny: the socket that asked, or null for a request gone. */
    const ix::WebSocket* deny(const std::string& requestId);

    /** The device holding `key`, now speaking through `on`; nullopt for a key no device holds. */
    std::optional<Device> verify(const std::string& key, const ix::WebSocket* on);

    /** Forget a device; the sockets it was speaking through are returned, to be untrusted and closed. */
    std::vector<const ix::WebSocket*> revoke(const std::string& deviceId);

    /** A socket closed: its pending request and its device binding go with it; true when a request went. */
    bool forget(const ix::WebSocket* ws);

    std::vector<Request> pending();
    std::vector<Device> devices();

private:
    void prune(long long now);   // expired requests out; called with mx_ held
    void save();                 // the devices to disk; called with mx_ held

    std::mutex mx_;
    std::string file_;
    struct Stored {
        Device device;
        std::string key;
    };
    std::vector<Stored> devices_;
    std::map<std::string, std::pair<Request, const ix::WebSocket*>> requests_;
    std::map<const ix::WebSocket*, std::string> bound_;   // socket -> device id
};

}  // namespace studio
