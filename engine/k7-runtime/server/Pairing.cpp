// Pairing.cpp — the store behind Pairing.h: `<state>/paired-devices.json`, written whole on every change.
// Keys are kept in clear, like the engine's own token in engine-id.json: what reads that folder owns the machine.

#include "Pairing.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
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

}  // namespace

// Equal without returning early on the first difference, so a guess learns nothing from the time it took.
bool sameKey(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

bool isLoopbackAddress(const std::string& ip) {
    std::string v = ip;
    if (v.rfind("::ffff:", 0) == 0) v = v.substr(7);
    return v == "::1" || v == "localhost" || v.rfind("127.", 0) == 0;
}

bool isPrivateAddress(const std::string& ip) {
    std::string v = ip;
    if (v.rfind("::ffff:", 0) == 0) v = v.substr(7);
    unsigned a = 0, b = 0, c = 0, d = 0;
    char tail = 0;
    if (std::sscanf(v.c_str(), "%u.%u.%u.%u%c", &a, &b, &c, &d, &tail) == 4) {
        if (a > 255 || b > 255 || c > 255 || d > 255) return false;
        return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
    }
    if (v.find(':') == std::string::npos || v.size() < 4) return false;
    std::string h = v.substr(0, 4);
    for (char& ch : h) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    // fc00::/7 is the unique-local range, fe80::/10 the link-local one.
    return h[0] == 'f' && (h[1] == 'c' || h[1] == 'd' || (h[1] == 'e' && h[2] >= '8' && h[2] <= 'b'));
}

namespace {

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

/** `origin` lower-cased and without a trailing slash, the one spelling both sides are compared in. */
std::string normalOrigin(const std::string& origin) {
    std::string o = lower(origin);
    while (!o.empty() && o.back() == '/') o.pop_back();
    return o;
}

}  // namespace

bool originAllowed(const std::string& origin, const std::vector<std::string>& extra) {
    const std::string o = normalOrigin(origin);
    const size_t sep = o.find("://");
    if (sep == std::string::npos) return false;
    const std::string scheme = o.substr(0, sep);
    // A browser never sends a ws: origin, so this is a native client (IXWebSocket sends one by default).
    if (scheme == "ws" || scheme == "wss") return true;
    for (const auto& e : extra)
        if (normalOrigin(e) == o) return true;
    if (scheme != "http" && scheme != "https") return false;
    const std::string rest = o.substr(sep + 3);
    const size_t hostEnd = rest.rfind(':');
    const bool bracketed = !rest.empty() && rest.front() == '[';
    const bool hasPort = hostEnd != std::string::npos && (!bracketed || hostEnd > rest.find(']'));
    const std::string host = hasPort ? rest.substr(0, hostEnd) : rest;
    const std::string port = hasPort ? rest.substr(hostEnd + 1) : std::string{};
    if (hasPort && (port.empty() || port.find_first_not_of("0123456789") != std::string::npos)) return false;
    if (host == "127.0.0.1" || host == "localhost" || host == "[::1]") return true;
    if (scheme != "https" || hasPort) return false;
    const std::string apex = "k7.rocks";
    if (host == apex) return true;
    const std::string sub = "." + apex;
    if (host.size() <= sub.size() || host.compare(host.size() - sub.size(), sub.size(), sub) != 0) return false;
    // Only letters, digits, dots and dashes before the apex, so nothing like `user@` can pass for a subdomain.
    return host.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789.-") == std::string::npos;
}

std::vector<std::string> parseOrigins(const std::string& list) {
    std::vector<std::string> out;
    size_t start = 0;
    while (start <= list.size()) {
        size_t comma = list.find(',', start);
        if (comma == std::string::npos) comma = list.size();
        std::string one = list.substr(start, comma - start);
        const size_t a = one.find_first_not_of(" \t");
        const size_t b = one.find_last_not_of(" \t");
        if (a != std::string::npos) {
            one = normalOrigin(one.substr(a, b - a + 1));
            if (!one.empty()) out.push_back(one);
        }
        start = comma + 1;
    }
    return out;
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
    std::error_code ec;
    // The keys are secrets: only the account the engine runs as may read them.
    std::filesystem::permissions(tmp, std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
                                 std::filesystem::perm_options::replace, ec);
    // std::filesystem::rename replaces an existing target on Windows too, where std::rename refuses.
    std::filesystem::rename(tmp, file_, ec);
    if (ec) std::cerr << "[pairing] cannot save " << file_ << ": " << ec.message() << "\n";
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
