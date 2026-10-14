// ServePairing.cpp — the gate every message passes first: a loopback peer drives, a LAN peer drives once paired,
// and approving a device is the machine's own business. The verbs and the flow are in docs/pairing.md.
// The one thing a reader would get wrong: relayed traffic (tunnel, WebRTC) reaches us from loopback, and is trusted.

#include "ServeContext.h"

#include <iostream>
#include <unordered_set>

using json = nlohmann::json;

namespace studio {

namespace {

// What only the machine itself may ask: a paired phone cannot approve a second one, nor list what pairs it.
const std::unordered_set<std::string> kLocalOnly = {"pair-approve", "pair-deny", "list-pair-requests",
                                                    "list-paired-devices", "unpair-device"};

json requestsJson(Pairing& p) {
    json arr = json::array();
    for (const auto& r : p.pending())
        arr.push_back({{"requestId", r.id}, {"name", r.name}, {"ip", r.ip}, {"code", r.code}, {"since", r.createdMs}});
    return {{"type", "pair-requests"}, {"requests", arr}};
}

json devicesJson(Pairing& p) {
    json arr = json::array();
    for (const auto& d : p.devices())
        arr.push_back({{"deviceId", d.id}, {"name", d.name}, {"created", d.createdMs}, {"lastSeen", d.lastSeenMs}});
    return {{"type", "paired-devices"}, {"devices", arr}};
}

void trust(ServeContext& ctx, const ix::WebSocket* ws, bool isLocal) {
    std::lock_guard<std::mutex> lk(ctx.trustMx);
    ctx.trusted.insert(ws);
    if (isLocal) ctx.local.insert(ws);
}

void untrust(ServeContext& ctx, const ix::WebSocket* ws) {
    std::lock_guard<std::mutex> lk(ctx.trustMx);
    ctx.trusted.erase(ws);
    ctx.local.erase(ws);
}

void refuse(ix::WebSocket& ws, const std::string& code, const std::string& message) {
    ws.send(json{{"type", "error"}, {"code", code}, {"message", message}}.dump());
}

}  // namespace

bool screenMessage(ServeContext& ctx, ix::WebSocket& ws, const std::string& peerIp, const json& j,
                   const std::string& type) {
    auto& pairing = *ctx.pairing;
    const bool isLocal = isLoopbackAddress(peerIp);
    if (isLocal) trust(ctx, &ws, true);
    const bool trusted = isLocal || ctx.isTrusted(&ws);

    if (type == "pair-request") {
        if (isLocal) {
            refuse(ws, "not-needed", "this machine needs no pairing");
            return true;
        }
        const auto r = pairing.request(j.value("name", std::string{}), peerIp, &ws);
        if (!r) {
            refuse(ws, "busy", "too many devices are waiting to be paired — try again in a couple of minutes");
            return true;
        }
        ws.send(json{{"type", "pair-pending"}, {"requestId", r->id}, {"code", r->code}}.dump());
        std::cerr << "[pairing] '" << r->name << "' (" << peerIp << ") asks to pair, code " << r->code << "\n";
        ctx.broadcastLocal(requestsJson(pairing));
        return true;
    }

    if (type == "pair") {
        const auto key = j.value("key", std::string{});
        // The engine's own token pairs too: it is what the server holds, for a relay dialling us over the LAN.
        if (!key.empty() && key == ctx.engineToken) {
            trust(ctx, &ws, false);
            ws.send(json{{"type", "paired"}}.dump());
            return true;
        }
        if (const auto d = key.empty() ? std::nullopt : pairing.verify(key, &ws)) {
            trust(ctx, &ws, false);
            ws.send(json{{"type", "paired"}, {"deviceId", d->id}, {"name", d->name}}.dump());
            return true;
        }
        refuse(ws, "unpaired", "this device is not paired with the engine (or was unpaired) — pair it again");
        return true;
    }

    if (!trusted) {
        // A probe still learns that an engine is here and that it wants pairing — never its token.
        if (type == "whoami" || type == "hello") {
            ws.send(json{{"type", "whoami"}, {"id", ctx.engineId}, {"boot", ctx.bootId}, {"needsPairing", true}}.dump());
            return true;
        }
        refuse(ws, "unpaired", "this device is not paired with the engine — pair it first");
        return true;
    }

    if (kLocalOnly.count(type) == 0) return false;
    if (!isLocal) {
        refuse(ws, "local-only", "only the machine running the engine can manage paired devices");
        return true;
    }

    if (type == "list-pair-requests") {
        ws.send(requestsJson(pairing).dump());
    } else if (type == "list-paired-devices") {
        ws.send(devicesJson(pairing).dump());
    } else if (type == "pair-approve") {
        const auto a = pairing.approve(j.value("requestId", std::string{}));
        if (!a) {
            refuse(ws, "gone", "that request expired or was already answered");
            return true;
        }
        // The key goes to the device that asked, and nowhere else; it is never sent again.
        if (a->from != nullptr) {
            trust(ctx, a->from, false);
            ctx.sendTo(a->from, {{"type", "paired"}, {"deviceId", a->device.id}, {"name", a->device.name}, {"key", a->key}});
        }
        std::cerr << "[pairing] '" << a->device.name << "' paired\n";
        ctx.broadcastLocal(requestsJson(pairing));
        ctx.broadcastLocal(devicesJson(pairing));
    } else if (type == "pair-deny") {
        const auto requestId = j.value("requestId", std::string{});
        if (const auto* from = pairing.deny(requestId))
            ctx.sendTo(from, {{"type", "pair-denied"}, {"requestId", requestId}});
        ctx.broadcastLocal(requestsJson(pairing));
    } else if (type == "unpair-device") {
        // Its live connections lose their trust now, and are closed: an unpaired phone must not keep driving.
        for (const auto* live : pairing.revoke(j.value("deviceId", std::string{}))) {
            untrust(ctx, live);
            ctx.closeSocket(live);
        }
        ctx.broadcastLocal(devicesJson(pairing));
    }
    return true;
}

void forgetSocket(ServeContext& ctx, const ix::WebSocket* ws) {
    untrust(ctx, ws);
    if (ctx.pairing != nullptr && ctx.pairing->forget(ws)) ctx.broadcastLocal(requestsJson(*ctx.pairing));
}

}  // namespace studio
