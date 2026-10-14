// Pairing.cpp — the store behind Pairing.h: `<state>/paired-devices.json`, written whole on every change.
// Keys are kept in clear, like the engine's own token in engine-id.json: what reads that folder owns the machine.

#include "Pairing.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <random>

namespace studio {

namespace {

using json = nlohmann::json;

// How long a request waits for the musician, and how many may wait at once: a LAN peer cannot queue the room.
constexpr long long kRequestTtlMs = 2 * 60 * 1000;
constexpr size_t kMaxPending = 8;

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// `bytes` random bytes as hex, from the OS's generator — a key is a secret, not a hash seed.
std::string randomHex(size_t bytes) {
    std::random_device rd;
    std::string out;
    char buf[3];
    for (size_t i = 0; i < bytes; ++i) {
        std::snprintf(buf, sizeof buf, "%02x", static_cast<unsigned>(rd() & 0xff));
        out += buf;
    }
    return out;
}

// Six digits a person reads on one screen and finds on another.
std::string randomCode() {
    std::random_device rd;
    char buf[8];
    std::snprintf(buf, sizeof buf, "%06u", static_cast<unsigned>(rd() % 1000000u));
    return buf;
}

// Equal without returning early on the first difference, so a guess learns nothing from the time it took.
bool sameKey(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

}  // namespace

bool isLoopbackAddress(const std::string& ip) {
    std::string v = ip;
    if (v.rfind("::ffff:", 0) == 0) v = v.substr(7);
    return v == "::1" || v == "localhost" || v.rfind("127.", 0) == 0;
}

Pairing::Pairing(std::string file) : file_(std::move(file)) {
    std::ifstream in(file_);
    if (!in) return;
    try {
        const auto j = json::parse(in);
        for (const auto& d : j.value("devices", json::array()))
            devices_.push_back({{d.value("id", std::string{}), d.value("name", std::string{}),
                                 d.value("created", 0LL), d.value("lastSeen", 0LL)},
                                d.value("key", std::string{})});
    } catch (const std::exception&) {
        devices_.clear();   // an unreadable store pairs nobody, and the next change rewrites it
    }
    devices_.erase(std::remove_if(devices_.begin(), devices_.end(),
                                  [](const Stored& s) { return s.key.size() < 32 || s.device.id.empty(); }),
                   devices_.end());
}

void Pairing::save() {
    json arr = json::array();
    for (const auto& s : devices_)
        arr.push_back({{"id", s.device.id}, {"name", s.device.name}, {"key", s.key},
                       {"created", s.device.createdMs}, {"lastSeen", s.device.lastSeenMs}});
    // Written aside and renamed, so a crash mid-write cannot unpair every device.
    const std::string tmp = file_ + ".tmp";
    {
        std::ofstream out(tmp, std::ios::trunc);
        out << json{{"devices", arr}}.dump(2);
        if (!out) return;
    }
    std::rename(tmp.c_str(), file_.c_str());
}

void Pairing::prune(long long now) {
    for (auto it = requests_.begin(); it != requests_.end();)
        it = now - it->second.first.createdMs > kRequestTtlMs ? requests_.erase(it) : std::next(it);
}

std::optional<Pairing::Request> Pairing::request(const std::string& name, const std::string& ip,
                                                 const ix::WebSocket* from) {
    std::lock_guard<std::mutex> lk(mx_);
    const long long now = nowMs();
    prune(now);
    // One pending request per socket: asking again replaces it, with a new code.
    for (auto it = requests_.begin(); it != requests_.end();)
        it = it->second.second == from ? requests_.erase(it) : std::next(it);
    if (requests_.size() >= kMaxPending) return std::nullopt;
    Request r{randomHex(4), name.empty() ? std::string("a device") : name.substr(0, 64), ip, randomCode(), now};
    requests_[r.id] = {r, from};
    return r;
}

std::optional<Pairing::Approved> Pairing::approve(const std::string& requestId) {
    std::lock_guard<std::mutex> lk(mx_);
    const long long now = nowMs();
    prune(now);
    const auto it = requests_.find(requestId);
    if (it == requests_.end()) return std::nullopt;
    Approved a{{randomHex(4), it->second.first.name, now, now}, randomHex(32), it->second.second};
    requests_.erase(it);
    devices_.push_back({a.device, a.key});
    if (a.from != nullptr) bound_[a.from] = a.device.id;
    save();
    return a;
}

const ix::WebSocket* Pairing::deny(const std::string& requestId) {
    std::lock_guard<std::mutex> lk(mx_);
    const auto it = requests_.find(requestId);
    if (it == requests_.end()) return nullptr;
    const auto* from = it->second.second;
    requests_.erase(it);
    return from;
}

std::optional<Pairing::Device> Pairing::verify(const std::string& key, const ix::WebSocket* on) {
    std::lock_guard<std::mutex> lk(mx_);
    for (auto& s : devices_)
        if (sameKey(s.key, key)) {
            const long long now = nowMs();
            // Persisted at most hourly: "last seen" is for a person deciding what to revoke, not a heartbeat.
            const bool stale = now - s.device.lastSeenMs > 60LL * 60 * 1000;
            s.device.lastSeenMs = now;
            if (stale) save();
            if (on != nullptr) bound_[on] = s.device.id;
            return s.device;
        }
    return std::nullopt;
}

std::vector<const ix::WebSocket*> Pairing::revoke(const std::string& deviceId) {
    std::lock_guard<std::mutex> lk(mx_);
    std::vector<const ix::WebSocket*> live;
    const auto before = devices_.size();
    devices_.erase(std::remove_if(devices_.begin(), devices_.end(),
                                  [&](const Stored& s) { return s.device.id == deviceId; }),
                   devices_.end());
    if (devices_.size() == before) return live;
    for (auto it = bound_.begin(); it != bound_.end();) {
        if (it->second == deviceId) {
            live.push_back(it->first);
            it = bound_.erase(it);
        } else {
            ++it;
        }
    }
    save();
    return live;
}

bool Pairing::forget(const ix::WebSocket* ws) {
    std::lock_guard<std::mutex> lk(mx_);
    bound_.erase(ws);
    bool dropped = false;
    for (auto it = requests_.begin(); it != requests_.end();) {
        if (it->second.second == ws) {
            it = requests_.erase(it);
            dropped = true;
        } else {
            ++it;
        }
    }
    return dropped;
}

std::vector<Pairing::Request> Pairing::pending() {
    std::lock_guard<std::mutex> lk(mx_);
    prune(nowMs());
    std::vector<Request> out;
    for (const auto& [id, r] : requests_) out.push_back(r.first);
    return out;
}

std::vector<Pairing::Device> Pairing::devices() {
    std::lock_guard<std::mutex> lk(mx_);
    std::vector<Device> out;
    for (const auto& s : devices_) out.push_back(s.device);
    return out;
}

}  // namespace studio
