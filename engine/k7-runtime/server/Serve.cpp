// Serve.cpp — the headless audio server: a thin WebSocket bridge over studio::engine, speaking JSON.
// It parses no files — the Node brain interprets the song and sends it as a resolved ProjectDoc. This file
// includes NO JUCE/Tracktion headers: all engine threading sits behind EngineHost's post()/onState()/run().
// It owns the socket's lifecycle; the messages themselves are answered in ServeProject/ServePlugins/ServeMachine.cpp.

#include "Serve.h"
#include "AudioSender.h"
#include "Outbox.h"
#include "ServeContext.h"

#include "../engine/PathRoots.h"
#include "../engine/Warnings.h"

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocketServer.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <csignal>
#include <exception>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

#include <EngineHost.h>   // studio::engine

using json = nlohmann::json;

namespace {

// A peer that answers no ping for this long is closed: IXWebSocket's own default is never, and a send to a peer that stopped reading blocks until it goes (docs/audit-stabilite.md).
constexpr int kPingIntervalSecs = 10;

// …and one blocking send may wait this long before the socket is dropped.
constexpr int kSendTimeoutSecs = 5;

// A ceiling on a session id, not a shape: naming one creates it, so only a length that attacks the map is worth refusing — real ids are tens of bytes.
constexpr size_t kMaxSessionIdBytes = 256;
constexpr size_t kMaxSessions = studio::EngineHost::kMaxSessions;

studio::EngineHost* g_host = nullptr;   // for requestQuit

// Set by the signal handler and nothing else — the one thing a handler may do — and turned into quit() by the sender thread.
volatile std::sig_atomic_t g_quitSignalled = 0;

// Process-lifetime, not serve()'s: a thread still unlocking it as serve() returns must not meet a destroyed mutex.
studio::DetachedWork g_work;

}  // namespace

namespace studio {

void requestQuit() {
    if (g_host) g_host->quit();
}

void suspendAudio(bool suspended) {
    if (auto* host = g_host) host->post([host, suspended] { host->suspendAudio(suspended); });
}

int serve(int port) {
    // The last word before a throw nothing wrapped ends the process — a JUCE thread's, a plugin's: said on stderr, which the supervisor keeps, instead of nothing.
    std::set_terminate([] {
        std::cerr << "[fatal] terminate";
        if (const auto e = std::current_exception()) {
            try {
                std::rethrow_exception(e);
            } catch (const std::exception& x) {
                std::cerr << ": " << x.what();
            } catch (...) {
                std::cerr << ": unknown exception";
            }
        }
        std::cerr << std::endl;
        std::abort();
    });
    // Engine identity (Phase-1 local trust): a stable id and secret token by env, echoed on `whoami`, so a lookalike cannot impersonate this engine; empty without the supervisor, and an empty id matches no selection.
    const char* idEnv = std::getenv("STUDIO_ENGINE_ID");
    const char* tokEnv = std::getenv("STUDIO_ENGINE_TOKEN");
    const std::string engineId = idEnv ? idEnv : "";
    const std::string engineToken = tokEnv ? tokEnv : "";

    // Time the startup phases: before the port opens a client sees only a refused connection, so a slow start is otherwise undiagnosable; std::chrono, since this file keeps no JUCE includes.
    const auto bootT = std::chrono::steady_clock::now();
    const auto sinceBoot = [&bootT] {
        return std::chrono::duration<double, std::milli>(
                   std::chrono::steady_clock::now() - bootT)
            .count();
    };

    ix::initNetSystem();

    // Before anything loads: a plugin or a model the last engine died loading is struck now, and refused at the second strike (docs/crashes.md).
    studio::enableLoadGuards();
    // `$STUDIO_ENGINE_SAFE_MODE=<crashes>`: the supervisor saw this engine die that many times in a row, so no external plugin loads.
    const char* safeEnv = std::getenv("STUDIO_ENGINE_SAFE_MODE");
    const int safeModeCrashes = safeEnv ? (std::max)(0, std::atoi(safeEnv)) : 0;
    studio::setSafeMode(safeModeCrashes > 0);
    if (safeModeCrashes > 0)
        std::cerr << "[safe-mode] started after " << safeModeCrashes << " quick crashes: no external plugin will load\n";
    // Every file a document names is held to these from here on: the state folder and $STUDIO_ENGINE_ROOTS, plus temp for reads (docs/pathRoots.md).
    studio::setPathRoots(studio::defaultPathRoots(studio::studioStatePath()));

    // Constructing the host builds the Tracktion engine and opens NO audio device — that is queued below so the port binds first, since opening one takes seconds and a refused connection reads as an absent engine.
    studio::EngineHost host;
    g_host = &host;
    const double ctorMs = sinceBoot();

    // Open the audio device as the FIRST message-thread action, enqueued before any client is accepted so it runs ahead of any project apply; the port answers probes without waiting on it.
    host.post([&host, &sinceBoot, ctorMs] {
        const double t0 = sinceBoot();
        host.openAudioDevice();
        const double t1 = sinceBoot();
        std::cerr << "[startup] tracktion=" << ctorMs << "ms audioDevice="
                  << (t1 - t0) << "ms (device ready at " << t1 << "ms)\n";
        // The device setup is persisted, so a bad one survives restarts: with no output there is no audio callback, play "works" and nothing sounds. Say it once.
        if (host.outputDeviceName().empty())
            std::cerr << "warning: no audio OUTPUT device is open — the transport will "
                         "run but the playhead won't advance and nothing will sound. "
                         "Pick an output with 'k7 config --set interface'.\n";
    });

    // Loopback by default; the supervisor sets STUDIO_ENGINE_HOST=0.0.0.0 for LAN browsers — only the bind interface changes, and there is still no auth beyond the whoami token echo.
    const char* hostEnv = std::getenv("STUDIO_ENGINE_HOST");
    const std::string bindHost = (hostEnv && *hostEnv) ? hostEnv : "127.0.0.1";
    ix::WebSocketServer server(port, bindHost, ix::SocketServer::kDefaultTcpBacklog,
                               ix::SocketServer::kDefaultMaxConnections,
                               ix::WebSocketServer::kDefaultHandShakeTimeoutSecs,
                               ix::SocketServer::kDefaultAddressFamily, kPingIntervalSecs,
                               kSendTimeoutSecs);

    // Every JSON push goes through the outbox's writer thread: a send blocks until the peer drains, and the message thread must never be what waits (docs/audit-stabilite.md).
    Outbox outbox;
    outbox.start();

    // The start time in ms names this process: the supervisor's relaunch after a crash is a new one.
    const std::string bootId = std::to_string(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    ServeContext ctx{host, g_work, engineId, engineToken, bootId};
    if (const char* v = std::getenv("STUDIO_ENGINE_ALLOWED_ORIGINS")) ctx.allowedOrigins = parseOrigins(v);
    // The server's engine plays into a null sink, so its listeners are told to hear it through the broadcast.
    if (const char* v = std::getenv("STUDIO_AUDIO_TO_BROWSER"); v && std::string(v) == "1") ctx.audioToBrowser = true;
    ctx.safeModeCrashes = safeModeCrashes;
    // The LAN devices allowed to drive, and the requests waiting for the musician (docs/pairing.md).
    Pairing pairing(studio::studioStatePath() + "/paired-devices.json");
    ctx.pairing = &pairing;
    // A machine-wide reply reaches trusted sockets only: an unpaired LAN peer hears nothing but its own refusals.
    ctx.broadcast = [&server, &outbox, &ctx](const json& j) {
        const auto payload = std::make_shared<const std::string>(j.dump());
        for (auto& client : server.getClients())
            if (ctx.isTrusted(client.get())) outbox.post(client, payload, false);
    };
    ctx.broadcastLocal = [&server, &outbox, &ctx](const json& j) {
        const auto payload = std::make_shared<const std::string>(j.dump());
        for (auto& client : server.getClients()) {
            std::lock_guard<std::mutex> lk(ctx.trustMx);
            if (ctx.local.count(client.get()) != 0) outbox.post(client, payload, false);
        }
    };
    ctx.sendTo = [&server, &outbox](const ix::WebSocket* to, const json& j) {
        for (auto& client : server.getClients())
            if (client.get() == to) outbox.post(client, std::make_shared<const std::string>(j.dump()), false);
    };
    ctx.closeSocket = [&server](const ix::WebSocket* which) {
        for (auto& client : server.getClients())
            if (client.get() == which) client->close();
    };
    ctx.broadcastTo = [&ctx](const std::string& sid, json j) {
        j["session"] = sid;
        ctx.broadcast(j);
    };
    auto& broadcast = ctx.broadcast;
    auto& broadcastTo = ctx.broadcastTo;
    auto& listenersMx = ctx.listenersMx;
    auto& listeners = ctx.listeners;
    auto& drivers = ctx.drivers;
    auto& subscribers = ctx.subscribers;

    HandlerTable handlers;
    addProjectHandlers(handlers);
    addPluginHandlers(handlers);
    addMachineHandlers(handlers);

    // Read-only queries a short-lived PROBE fires and drops, plus `io-levels` and `instrument-status`, which are polled: announcing them would bury the log, so a connection sending only these stays silent.
    static const std::unordered_set<std::string> probeQueries = {
        "whoami", "list-audio-devices", "list-plugins", "list-edit-plugins",
        "list-sessions", "io-levels", "instrument-status"};

    // Verbs whose `session` names ANOTHER project than the sender's, so they must not bind the socket's once-only subscription (docs/sessions.md).
    static const std::unordered_set<std::string> overrideQueries = {
        "drop-session", "show-native-plugin-ui", "show-native-plugin-ui-of"};

    // The verbs a later message of the same kind may make pointless before they run (docs/supersede.md).
    static const std::unordered_set<std::string> supersedable = {
        "project", "tracks", "set-plugin-param"};

    // Which connections earned their deferred "[client] connected" line, so a disconnect logs only when the connect did; mutex-guarded, since IXWebSocket runs each callback on its own thread.
    std::mutex loggedMx;
    std::unordered_set<std::string> loggedConns;

    // Named rather than passed inline, so the registration below can wrap it in the one try/catch this socket has — see there.
    auto onMessage =
        [&ctx, &host, &handlers, &loggedMx, &loggedConns, &listenersMx, &listeners, &drivers,
         &subscribers](std::shared_ptr<ix::ConnectionState> conn, ix::WebSocket& ws,
                       const ix::WebSocketMessagePtr& msg) {
            // Who is talking to us — an arrival or a drop explains most of what follows, since a reconnect re-sends the whole project; the line is deferred to the first real message so probes never print one.
            // A page from a site not allowed is closed at its handshake and heard no further (docs/pairing.md).
            if (screenOrigin(ctx, ws, msg) || msg->type == ix::WebSocketMessageType::Open)
                return;
            if (msg->type == ix::WebSocketMessageType::Close) {
                // Drop the listener FIRST, and take the tap off when it was the last: a closed tab never sends {"broadcast": false}, so the engine would encode 200 frames a second for nobody forever.
                {
                    // The post happens UNDER the lock, so a departing listener's false cannot land after an arriving one's true and silence a listener that is still there.
                    std::lock_guard<std::mutex> lk(listenersMx);
                    if (auto gone = listeners.find(&ws); gone != listeners.end()) {
                        const std::string sid = gone->second;
                        listeners.erase(gone);
                        // Said out loud, because from outside you cannot tell "stopped tapping" from "still copying every block for nobody".
                        std::cerr << "[broadcast] listener gone from '" << sid << "' ("
                                  << listeners.size() << " listening)\n";
                        // The last ear on THAT session, not on the engine: counting them all had a closing m9 tab take the tap off the DEFAULT session, silencing an k7 listener still there.
                        const bool anyLeft =
                            std::any_of(listeners.begin(), listeners.end(),
                                        [&](const auto& e) { return e.second == sid; });
                        if (!anyLeft)
                            host.post([&host, sid] { host.enableBroadcast(sid, false); });
                    }

                    // A DRIVER leaving is the other half, and the one that frees a project — under the same lock, or a live session could end up counted as abandoned.
                    if (auto d = drivers.find(&ws); d != drivers.end()) {
                        const std::string sid = d->second;
                        drivers.erase(d);
                        host.post([&host, sid] { host.removeDriver(sid); });
                    }

                    // And stop addressing state frames to it; the raw-pointer key costs at most one dropped frame if reused (docs/protocol.md).
                    subscribers.erase(&ws);
                }
                // Its trust goes with it: a pointer reused by the next connection must earn its own.
                forgetSocket(ctx, &ws);
                bool announced;
                {
                    std::lock_guard<std::mutex> lk(loggedMx);
                    announced = loggedConns.erase(conn->getId()) > 0;
                }
                if (announced)
                    std::cerr << "[client] disconnected (code " << msg->closeInfo.code
                              << (msg->closeInfo.reason.empty()
                                      ? std::string{}
                                      : ", " + msg->closeInfo.reason)
                              << ")\n";
                return;
            }
            if (msg->type != ix::WebSocketMessageType::Message)
                return;

            if (screenFrameSize(ctx, ws, conn->getRemoteIp(), msg->str.size())) return;
            json j;
            try {
                j = json::parse(msg->str);
            } catch (const std::exception& e) {
                ws.send(json{{"type", "error"}, {"message", std::string("bad json: ") + e.what()}}.dump());
                return;
            }

            const std::string type = j.value("type", std::string{});

            // Who may say it, before anything else: a LAN peer is answered here until it is paired (docs/pairing.md).
            if (screenMessage(ctx, ws, conn->getRemoteIp(), j, type)) return;

            // WHICH project this message is about; absent means the default session, so a client that never heard of sessions keeps working exactly as before.
            const std::string session = j.value("session", std::string{});
            // Naming a session is what creates it, so there is no allowlist — only a ceiling, so a malformed client cannot grow the map without bound.
            if (session.size() > kMaxSessionIdBytes) {
                ws.send(json{{"type", "error"}, {"message", "session id too long"}}.dump());
                return;
            }
            // …and a ceiling on HOW MANY, which the length does not bound: a NEW one past it is refused, an existing one always answered.
            const bool creates = probeQueries.count(type) == 0 || j.value("role", std::string{}) == "driver";
            if (!session.empty() && creates && !host.hasSession(session) &&
                host.sessionIds().size() >= kMaxSessions) {
                ws.send(json{{"type", "error"}, {"message", "this engine holds too many sessions"}}.dump());
                return;
            }

            // The first REAL message — anything but a supervision or probe query — earns this connection its deferred line.
            if (probeQueries.count(type) == 0) {
                bool firstReal;
                {
                    std::lock_guard<std::mutex> lk(loggedMx);
                    firstReal = loggedConns.insert(conn->getId()).second;
                }
                if (firstReal)
                    std::cerr << "[client] connected (" << conn->getRemoteIp() << ")\n";
                // …and says which project to send it state about; a probe never asks, so 20 frames a second aimed at it would be pure copy.
                if (overrideQueries.count(type) == 0) {
                    bool joined;
                    {
                        std::lock_guard<std::mutex> lk(listenersMx);
                        joined = subscribers.emplace(&ws, session).second;
                    }
                    // A NEW subscriber holds none of the take being recorded, so the next frame carries the whole picture (docs/recorder.md).
                    if (joined)
                        host.post([&host, session] { host.rewindRecorderEnvelopes(session); });
                }
            }

            // Every verb but the three that can be superseded, and the read-only probes, fences what was queued before it (docs/supersede.md).
            if (supersedable.count(type) == 0 && probeQueries.count(type) == 0)
                ctx.supersede.barrier(session);

            if (const auto* handle = handlers.find(type)) {
                (*handle)(ctx, ws, j, session, type);
            } else {
                // A message we don't understand is version skew between brain and engine — logged here too, or the only trace is an error the client may be ignoring.
                std::cerr << "[client] unknown message type: '" << type << "'\n";
                ws.send(json{{"type", "error"}, {"message", "unknown message type: " + type}}.dump());
            }
        };

    // The ONE catch on this socket, and load-bearing: IXWebSocket has none, so a throw from a handler would leave the socket deaf (docs/protocol.md).
    server.setOnClientMessageCallback(
        [&onMessage](std::shared_ptr<ix::ConnectionState> conn, ix::WebSocket& ws,
                     const ix::WebSocketMessagePtr& msg) {
            try {
                onMessage(std::move(conn), ws, msg);
            } catch (const std::exception& e) {
                // Logged as well as answered: a client ignoring `error` would otherwise leave no trace of it at all.
                std::cerr << "[client] refused a message: " << e.what() << "\n";
                ws.send(json{{"type", "error"},
                             {"message", std::string("malformed message: ") + e.what()}}
                            .dump());
            } catch (...) {
                std::cerr << "[client] refused a message (unknown exception)\n";
                ws.send(json{{"type", "error"}, {"message", "malformed message"}}.dump());
            }
        });

    // Push transport/meter state ~20x/second to the sockets that asked about THIS project, not to every socket on the port (docs/protocol.md).
    host.onState([&server, &outbox, &listenersMx, &subscribers](const studio::EngineHost::EngineState& s) {
        // Chosen under the lock and queued outside it; the shared_ptrs keep the sockets alive until the writer is done with them.
        std::vector<std::shared_ptr<ix::WebSocket>> targets;
        {
            const auto clients = server.getClients();
            std::lock_guard<std::mutex> lk(listenersMx);
            for (auto& client : clients)
                if (auto hit = subscribers.find(client.get());
                    hit != subscribers.end() && hit->second == s.session)
                    targets.push_back(client);
        }
        // Nobody asked about this session, so the frame is not even built.
        if (targets.empty()) return;

        // A peak to four decimals and a level to a hundredth of a dB: below anything drawn, and a third of the text (docs/protocol.md).
        const auto peak = [](float v) { return std::round(static_cast<double>(v) * 1e4) / 1e4; };
        const auto levels = [](const std::vector<float>& db) {
            json arr = json::array();
            for (const float v : db) arr.push_back(std::round(static_cast<double>(v) * 100.0) / 100.0);
            return arr;
        };
        json wf = json::object();
        for (const auto& [key, envelopes] : s.waveformEnvelopes) {
            json arr = json::array();
            for (const auto& e : envelopes)
                arr.push_back({{"min", peak(e.min)}, {"max", peak(e.max)}});
            wf[key] = std::move(arr);
        }
        json recs = json::object();
        for (const auto& [key, r] : s.recorders) {
            json takes = json::array();
            for (const auto& t : r.takes)
                takes.push_back({{"file", t.file}, {"seconds", t.seconds}, {"damaged", t.damaged}});
            json env = json::array();
            for (const auto& e : r.envelope)
                env.push_back({{"min", peak(e.min)}, {"max", peak(e.max)}});
            recs[key] = json{{"recording", r.recording},
                             {"seconds", r.seconds},
                             {"takes", std::move(takes)},
                             {"envelope", std::move(env)},
                             // Where those points START in the take: an append, or a resend already drawn (docs/recorder.md).
                             {"from", r.envelopeFrom}};
        }
        // The cost report, on the frames that carry one: absent otherwise, and the client keeps the last (docs/load.md).
        json load = nullptr;
        if (s.hasLoad) {
            json plugins = json::object();
            for (const auto& [id, l] : s.pluginLoads) {
                json p = {{"cpu", l.cpu}};
                if (l.bytes >= 0) p["bytes"] = l.bytes;
                plugins[id] = std::move(p);
            }
            load = {{"plugins", std::move(plugins)}};
            if (s.processBytes >= 0) load["process"] = s.processBytes;
        }
        json frame = json{
            {"type", "state"},
            // WHICH project this frame describes; empty is the default session, what a client that never asked for one drives.
            {"session", s.session},
            {"playing", s.playing},
            {"playhead", s.playheadSeconds},
            // The loop the transport wraps in, in seconds — so a client that reconnects draws the one that is playing.
            {"loop", {{"on", s.loop.on}, {"start", s.loop.startSeconds}, {"end", s.loop.endSeconds}}},
            {"levels", levels(s.trackLevelsDb)},
            {"inputLevels", levels(s.trackInputLevelsDb)},
            {"armed", s.armedTracks},
            {"recordEnabled", s.recordEnabled},
            // The master output and whether it overloaded since the last frame — the same number `io-levels` carries, read through a second client (docs/meterClients.md).
            {"master", s.masterLevelDb},
            {"masterClipped", s.masterOverload},
            {"waveform", std::move(wf)},
            // Each platter's own needle, in seconds of its record — absent for a deck playing a clip.
            {"platters", s.platterSeconds},
            // …and each RECORDER node: rolling or not, and its picture SINCE THE LAST FRAME, appended by the client (docs/recorder.md).
            {"recorders", std::move(recs)},
        };
        if (!load.is_null()) frame["load"] = std::move(load);
        const auto payload = std::make_shared<const std::string>(frame.dump());

        // Droppable: the next frame supersedes it, so a socket already behind skips this one.
        for (auto& client : targets) outbox.post(client, payload, true);
    }, 50);

    // A finished take: the file is closed and named, the brain turns it into a clip.
    host.onRecorded([&broadcastTo](const std::string& session, const std::string& trackId,
                                   const std::string& file, double start, double length) {
        broadcastTo(session, json{
            {"type", "recorded"},
            {"track", trackId},
            {"file", file},
            {"start", start},     // seconds; the brain owns the tempo map
            {"length", length},
        });
    });

    // When a plugin's editor closes the engine persists its state to the module — text params where they capture it, else a .vstpreset the file watcher picks up.
    host.onPluginParams([&broadcastTo](const std::string& session, const std::string& id,
                                       const std::string& paramsJson) {
        json params = json::object();
        try {
            params = json::parse(paramsJson);
        } catch (const std::exception&) {
        }
        broadcastTo(session, json{{"type", "plugin-params"}, {"id", id}, {"params", params}});
    });
    // Engine warnings reach the CLIENT and not just stderr: the supervisor adopts an engine it did not spawn, so its output goes nowhere a user can see.

    // Stamped when a WarningScope named a project, unstamped otherwise — a device or startup warning belongs to no session.
    studio::setWarningSink([&broadcast, &broadcastTo](const studio::Warning& w) {
        json msg{{"type", "engine-warning"}, {"subject", w.subject}, {"message", w.message}};
        if (w.session.empty()) broadcast(msg);
        else broadcastTo(w.session, msg);
    });

    // Watched plugins, whenever a value moves — its own type rather than `plugin-params`, which means "persist this" and would have every consumer one forgotten check from rewriting the project at 20 Hz.
    host.onPluginParamsLive(
        [&broadcastTo](const std::string& session, const std::string& id,
                       const std::vector<std::pair<std::string, double>>& p) {
            json params = json::object();
            for (const auto& [name, value] : p)
                params[name] = value;
            broadcastTo(session, json{{"type", "plugin-params-live"}, {"id", id}, {"params", params}});
        });

    const auto res = server.listen();
    if (!res.first) {
        std::cerr << "k7-runtime: listen failed: " << res.second << "\n";
        return 1;
    }
    server.start();

    // The audio broadcast, on its own thread (docs/broadcast.md); a signal's flag becomes quit() there, an ordinary thread.
    AudioSender audio(ctx, server, sinceBoot);
    ctx.audio = &audio;
    audio.start([&host] {
        if (g_quitSignalled) {
            g_quitSignalled = 0;
            host.quit();
        }
    });

    std::cerr << "k7-runtime listening on ws://" << bindHost << ":" << port
              << (engineId.empty() ? std::string{}
                                   : " (id " + engineId + ")")
              << "\n";
    std::cerr << "[startup] port bound at " << sinceBoot()
              << "ms (audio device opens on the message loop; its timing is logged "
                 "when it completes)\n";

    // The incremental scan at EVERY start, in the background: a plugin installed or removed since the last run is found without anyone asking (docs/plugins.md).
    g_work.spawn([&ctx] {
        std::cerr << (studio::pluginCacheWarm() ? "[plugins] startup scan — only new or changed files are loaded\n"
                                                : "[plugins] cache cold at startup — scanning in the background, "
                                                  "this can take a while\n");
        // Every socket hears the new list, as after a rescan: the hub rewrites the account's copy from it.
        ensurePluginsScanned(ctx, ScanWhen::Always,
                             [&ctx](const std::vector<PluginInfo>& plugins) { ctx.broadcast(pluginsJson(plugins)); });
        std::cerr << "[plugins] startup scan complete\n";
    });

    // A flag and nothing else: quit() posts a message, which allocates and locks, and neither is allowed in a signal handler.
    std::signal(SIGINT, [](int) { g_quitSignalled = 1; });
    std::signal(SIGTERM, [](int) { g_quitSignalled = 1; });

    host.run();          // blocks on the JUCE message loop until quit()
    // The sink holds this frame's broadcast verbs by reference, and a plugin torn down after it unwinds can still warn.
    studio::setWarningSink({});

    // server.stop() FIRST, then join: a sender can be parked in a send, and closing the socket is what unwedges it.
    audio.stop();
    outbox.stop();
    server.stop();
    audio.join();
    outbox.join();
    ctx.audio = nullptr;

    // The detached work captures this frame by reference: give it a moment, and if a scan or a plugin load is still running, leave WITHOUT unwinding rather than free what it holds.
    constexpr auto kDetachedGrace = std::chrono::seconds(3);
#ifdef STUDIO_ENGINE_IN_APP
    // Inside the app's own process, where exiting would take the app with it; nothing here scans or loads a binary plugin, so the wait is short.
    while (!g_work.waitIdle(kDetachedGrace)) {}
#else
    if (!g_work.waitIdle(kDetachedGrace)) {
        std::cerr << "[shutdown] background work still running — exiting without cleanup\n";
        std::cerr.flush();
        std::_Exit(0);
    }
#endif
    g_host = nullptr;

    ix::uninitNetSystem();
    return 0;
}

}  // namespace studio
