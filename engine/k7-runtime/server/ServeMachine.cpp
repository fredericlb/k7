// ServeMachine.cpp — the messages about the MACHINE and its sockets rather than one project: the audio stream,
// the sessions, the interface and its inputs, identity and driving (docs/protocol.md, docs/sessions.md).

#include "ServeContext.h"
#include "DocJson.h"
#include "AudioSender.h"
#include "WireVersion.h"

#include "../engine/InstrumentStatus.h"
#include "../engine/Warnings.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <EngineHost.h>
#include <ProjectDiff.h>

using json = nlohmann::json;

namespace studio {

namespace {

// A path's last component, either separator: a warning names a plugin's file, never the user's folders.
std::string fileNameOf(const std::string& path) {
    const auto slash = path.find_last_of("/\\");
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

// What `whoami` says of safe mode: the crashes, and the file the last engine died loading or else the plugin it loaded last (docs/crashes.md).
json safeModeOf(int crashes) {
    json out{{"crashes", crashes}};
    if (const auto died = previousLoadDeath(); !died.empty()) out["diedLoading"] = fileNameOf(died);
    if (const auto last = previousLastPlugin(); !last.empty()) out["lastPlugin"] = fileNameOf(last);
    return out;
}

// The 'audio-devices' reply, ASIO first, sent on request AND after a switch so clients learn the same way; message-thread only.
json audioDevicesMsg(EngineHost& host) {
    json arr = json::array();
    for (const auto& d : host.listAudioDevices())
        arr.push_back({{"name", d.name},
                       {"type", d.type},
                       {"inputs", d.inputs},
                       {"outputs", d.outputs},
                       {"current", d.current},
                       {"currentInput", d.currentInput},
                       {"isDefault", d.isDefault}});
    return json{{"type", "audio-devices"}, {"devices", arr}};
}

}  // namespace

void addMachineHandlers(HandlerTable& t) {
    t.add({"broadcast"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& listenersMx = ctx.listenersMx;
        auto& listeners = ctx.listeners;
        // Subscribe or unsubscribe THIS connection to the master audio stream; the tap goes on for the first listener and off after the last, so an unheard engine copies nothing.
        const bool on = j.value("on", false);
        size_t remaining = 0;
        bool first = false;
        // Which session this actually changes; resolved under the lock below, and logged after it.
        std::string target = session;
        {
            // Same discipline as the Close handler: decide and queue under one lock.
            std::lock_guard<std::mutex> lk(listenersMx);
            // Turning OFF retires the socket's OWN subscription, whatever session the message names — the Close handler's rule, and the only one that cannot strand a tap.
            if (!on)
                if (auto it = listeners.find(&ws); it != listeners.end()) target = it->second;
            // FIRST for THIS session, counted rather than tested on emptiness: another service already listening does not make this one mid-stream.
            first = on && std::none_of(listeners.begin(), listeners.end(),
                                       [&](const auto& kv) { return kv.second == target; });
            // A socket moving to another session leaves its old one: that one's tap goes off when nobody else hears it.
            std::string left;
            if (on)
                if (auto it = listeners.find(&ws); it != listeners.end() && it->second != target) left = it->second;
            if (on) listeners[&ws] = target;
            else listeners.erase(&ws);
            if (!left.empty() && std::none_of(listeners.begin(), listeners.end(),
                                              [&](const auto& kv) { return kv.second == left; }))
                host.post([left, &host] { host.enableBroadcast(left, false); });
            // THIS session's ears, exactly as the Close handler counts them: the engine-wide total
            // would leave the tap on a session nobody hears whenever another one still has a listener.
            remaining = static_cast<size_t>(
                std::count_if(listeners.begin(), listeners.end(),
                              [&](const auto& kv) { return kv.second == target; }));
            if (first && ctx.audio) ctx.audio->markArrived(target);
            host.post([target, &host, want = remaining > 0] { host.enableBroadcast(target, want); });
        }
        std::cerr << "[broadcast] " << (on ? "listener added to '" : "listener removed from '")
                  << target << "' (" << remaining << " listening to it)\n";
    });

    t.add({"list-sessions"}, [](ServeContext& ctx, ix::WebSocket&, const json&, const std::string&, const std::string&) {
        auto& host = ctx.host;
        auto& broadcast = ctx.broadcast;
        auto& listenersMx = ctx.listenersMx;
        auto& listeners = ctx.listeners;
        // Every session this engine holds — ENGINE-GLOBAL, being the one question about the OTHER sessions; the listener counts come from this file, snapshotted before the post so no lock is held across it.
        std::map<std::string, int> ears;
        {
            std::lock_guard<std::mutex> lk(listenersMx);
            for (const auto& [sock, sid] : listeners) {
                (void)sock;
                ++ears[sid];
            }
        }
        host.post([&host, &broadcast, ears] {
            json arr = json::array();
            for (const auto& s : host.sessionInfos()) {
                const auto hit = ears.find(s.id);
                arr.push_back({{"id", s.id},
                               {"project", s.loaded ? s.project : std::string{}},
                               {"loaded", s.loaded},
                               {"playing", s.playing},
                               {"tracks", s.trackCount},
                               {"listeners", hit == ears.end() ? 0 : hit->second}});
            }
            broadcast(json{{"type", "sessions"}, {"sessions", arr}});
        });
    });

    t.add({"drop-session"}, [](ServeContext& ctx, ix::WebSocket&, const json&, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Forget a session outright — the supervisor's way of clearing one an app left behind, addressed by `session` like every other message rather than by an `id` field.
        host.post([&host, session] {
            std::cerr << "[session] dropped '" << session << "'\n";
            host.dropSession(session);
        });
    });

    t.add({"audio-cost"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string&, const std::string&) {
        auto& host = ctx.host;
        // What the audio CALLBACK costs, and the deadline it has — the only number a DRIVER notices (docs/audit-stabilite.md). `reset` clears the window before measuring a gesture.
        if (j.value("reset", false)) host.resetCallbackCost();
        const auto c = host.callbackCost();
        // Answered on the ASKING socket and OFF the message thread, like whoami and for the same reason: both reads are atomics.
        ws.send(json{{"type", "audio-cost"},
                     {"meanMs", c.meanSeconds * 1000.0},
                     {"maxMs", c.maxSeconds * 1000.0},
                     {"minMs", c.minSeconds * 1000.0},
                     {"runs", c.runs},
                     {"deadlineMs", c.deadlineSeconds * 1000.0}}
                        .dump());
    });

    t.add({"list-audio-devices"}, [](ServeContext& ctx, ix::WebSocket&, const json&, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcast = ctx.broadcast;
        // Enumerate audio interfaces (message thread — touches JUCE devices).
        host.post([session, &host, &broadcast] { broadcast(audioDevicesMsg(host)); });
    });

    t.add({"io-levels"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // Meter the interface itself, one peak per `channels` entry plus the master — asked for rather than ridden on the state frame, since the pitch estimate is real work per channel; it ENABLES nothing (channelLevelsDb).
        std::vector<std::vector<int>> sets;
        for (const auto& s : j.value("channels", json::array())) {
            std::vector<int> ch;
            for (const auto& c : s) ch.push_back(c.get<int>());
            sets.push_back(std::move(ch));
        }
        host.post([session, &host, &broadcastTo, sets] {
            json levels = json::array();
            json found = json::array();
            for (const auto& l : host.channelLevelsDb(sets)) {
                levels.push_back(l.db);
                found.push_back(l.found);
            }
            // The device layout rides along: how the interface GROUPS its inputs is what explains a channel that exists and meters nothing.
            json devices = json::array();
            for (const auto& d : host.inputDevices())
                devices.push_back({{"name", d.name},
                                   {"channels", d.channels},
                                   {"enabled", d.enabled}});
            // …and the tuner's reading per input, on the same poll: same panel, same channels, and a second command would double the round trips.
            json pitches = json::array();
            json clarity = json::array();
            for (const auto& p : host.channelPitches(sets)) {
                pitches.push_back(p.hz);
                clarity.push_back(p.clarity);
            }
            // Stamped because "master" is this session's own output level: unstamped, two I/O panels on one engine read each other's meter.
            broadcastTo(session, json{{"type", "io-levels"},
                                      {"inputs", levels},
                                      {"found", found},
                                      {"pitches", pitches},
                                      {"clarity", clarity},
                                      {"devices", devices},
                                      {"master", host.masterLevelDb(session)}});
        });
    });

    t.add({"set-input-stereo"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // Group two interface inputs into one stereo device or split them, `channel` being 1-based and naming its PAIR — nothing is broadcast back, since the layout rides on `io-levels`, which the rebuild is forced through before returning.
        const int channel = j.value("channel", 0);
        const bool stereo = j.value("stereo", false);
        host.post([session, &host, &broadcastTo, channel, stereo] {
            if (!host.setInputStereo(channel, stereo))
                broadcastTo(session, json{{"type", "error"},
                                          {"message", "no audio interface open to group inputs on"}});
        });
    });

    t.add({"set-audio-device"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        auto& broadcast = ctx.broadcast;
        // Open a specific interface, replying with the new device list or an error; `deviceType` is the backend — NOT "type", which is the message kind.
        const std::string name = j.value("name", std::string{});
        const std::string deviceType = j.value("deviceType", std::string{});
        host.post([session, &host, &broadcast, &broadcastTo, name, deviceType] {
            // Switching the interface reopens the audio graph, worth a line: a device that opens slowly or not at all shows up as silence rather than an error.
            std::cerr << "[device] opening '" << name << "'"
                      << (deviceType.empty() ? std::string{} : " [" + deviceType + "]")
                      << "\n";
            // The new device list goes to EVERYONE, one interface per process meaning every session must learn a switch; the refusal goes only to whoever asked.
            if (host.setAudioDevice(name, deviceType))
                broadcast(audioDevicesMsg(host));
            else
                broadcastTo(session, json{{"type", "error"}, {"message", "audio device not available: " + name}});
        });
    });

    t.add({"instrument-status"}, [](ServeContext&, ix::WebSocket& ws, const json& j, const std::string&, const std::string&) {
        // Whether each `@instruments/` ref a project names is on this machine, for the asking socket alone; file stats only, so off the message thread (docs/protocol.md).
        json status = json::object();
        if (auto it = j.find("refs"); it != j.end() && it->is_array())
            for (const auto& r : *it)
                if (r.is_string() && status.size() < 256)
                    status[r.get<std::string>()] = instrumentInstalled(r.get<std::string>());
        ws.send(json{{"type", "instrument-status"}, {"status", status}}.dump());
    });

    t.add({"whoami", "hello"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& listenersMx = ctx.listenersMx;
        auto& drivers = ctx.drivers;
        const auto& engineId = ctx.engineId;
        const auto& engineToken = ctx.engineToken;
        // Identity probe, replied to the ASKING socket alone and answered OFF the message thread, which is safe only because audioTiming() reads two atomics (docs/protocol.md).
        const auto timing = host.audioTiming();
        json reply{{"type", "whoami"},
                   {"id", engineId},
                   {"token", engineToken},
                   {"boot", ctx.bootId},
                   {"protocol", kEngineProtocol},
                   {"build", buildStamp()},
                   {"bufferSize", timing.bufferFrames},
                   {"sampleRate", timing.sampleRate},
                   {"audioToBrowser", ctx.audioToBrowser}};
        if (ctx.safeModeCrashes > 0) reply["safeMode"] = safeModeOf(ctx.safeModeCrashes);
        ws.send(reply.dump());

        // …and, if this socket says it DRIVES a session, start counting it — on hello, so a reconnect restores the count, and ONCE per socket, since the keepalive re-sends whoami (docs/sessions.md).
        if (j.value("role", std::string{}) == "driver") {
            bool isNew;
            {
                std::lock_guard<std::mutex> lk(listenersMx);
                isNew = drivers.emplace(&ws, session).second;
            }
            if (isNew) host.post([&host, session] { host.addDriver(session); });
            // …and tell a driver arriving after the build what that build complained of, which was said only once (docs/sessions.md).
            if (isNew)
                for (const auto& w : standingWarnings(session))
                    ws.send(json{{"type", "engine-warning"},
                                 {"subject", w.subject},
                                 {"message", w.message},
                                 {"session", session}}
                                .dump());
        }
    });
}

}  // namespace studio
