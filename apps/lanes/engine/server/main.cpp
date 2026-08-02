// lanes-engine — the headless audio server: a thin WebSocket bridge over lanes::engine, speaking JSON.
// It parses no files — the Node brain interprets the song and sends it as a resolved ProjectDoc. This file
// includes NO JUCE/Tracktion headers: all engine threading sits behind EngineHost's post()/onState()/run().
// The message catalogue is in docs/protocol.md.

#include "../engine/Warnings.h"

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocketServer.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

#include <EngineHost.h>   // lanes::engine
#include <ProjectDiff.h>

using json = nlohmann::json;

namespace {

lanes::ProjectDoc docFromJson(const json& j) {
    lanes::ProjectDoc doc;
    doc.name = j.value("name", std::string{"untitled"});
    doc.tempo = j.value("tempo", 120.0);
    doc.sampleRate = j.value("sampleRate", 48000);
    doc.timeSigNumerator = j.value("timeSigNumerator", 4);
    doc.timeSigDenominator = j.value("timeSigDenominator", 4);
    doc.recordDir = j.value("recordDir", std::string{});
    // Project settings ride in a nested `settings` object; the engine reads only what it plays — the metronome flag
    // and the count-in bars. Absent settings mean the defaults.
    if (j.contains("settings") && j.at("settings").is_object()) {
        const auto& s = j.at("settings");
        doc.metronome = s.value("metronome", false);
        doc.countIn = s.value("countIn", 0);
    }

    if (j.contains("tracks")) {
        for (const auto& t : j.at("tracks")) {
            lanes::TrackDoc tr;
            tr.id = t.value("id", std::string{});
            tr.name = t.value("name", tr.id);
            tr.role = t.value("role", std::string{"regular"});
            tr.contentType = t.value("contentType", std::string{"audio"});
            tr.color = t.value("color", std::string{});
            tr.mute = t.value("mute", false);
            tr.solo = t.value("solo", false);
            tr.disabled = t.value("disabled", false);
            tr.monitor = t.value("monitor", std::string{"auto"});
            tr.inputGain = t.value("inputGain", 0.0);
            if (t.contains("inputChannels"))
                for (const auto& ch : t.at("inputChannels"))
                    if (ch.is_number_integer() && ch.get<int>() > 0)
                        tr.inputChannels.push_back(ch.get<int>());

            if (t.contains("clips"))
                for (const auto& c : t.at("clips")) {
                    lanes::ClipDoc cl;
                    cl.id = c.value("id", std::string{});
                    cl.type = c.value("type", std::string{"audio"}) == "midi"
                                  ? lanes::ClipType::Midi
                                  : lanes::ClipType::Audio;
                    cl.name = c.value("name", std::string{});
                    cl.source = c.value("source", std::string{});  // absolute path from Node
                    cl.start = c.value("start", 0.0);
                    cl.length = c.value("length", 0.0);
                    cl.offset = c.value("offset", 0.0);
                    cl.sourceFrom = c.value("sourceFrom", 0.0);
                    cl.sourceTo = c.value("sourceTo", 0.0);
                    cl.fadeIn = c.value("fadeIn", 0.0);
                    cl.fadeOut = c.value("fadeOut", 0.0);
                    cl.loopStart = c.value("loopStart", 0.0);
                    cl.loopEnd = c.value("loopEnd", 0.0);
                    cl.disabled = c.value("disabled", false);
                    if (c.contains("warp")) {
                        const auto& w = c.at("warp");
                        cl.warp.algorithm = w.value("algorithm", std::string{});
                        if (w.contains("markers"))
                            for (const auto& m : w.at("markers"))
                                cl.warp.markers.emplace_back(m.at(0).get<double>(),
                                                             m.at(1).get<double>());
                    }
                    if (c.contains("notes"))
                        for (const auto& n : c.at("notes")) {
                            lanes::NoteDoc nd;
                            nd.time = n.value("time", 0.0);
                            nd.duration = n.value("duration", 0.0);
                            nd.key = n.value("key", 0);
                            nd.vel = n.value("vel", 1.0);
                            nd.channel = n.value("channel", 0);
                            nd.rel = n.value("rel", 1.0);
                            cl.notes.push_back(nd);
                        }
                    tr.clips.push_back(std::move(cl));
                }

            if (t.contains("plugins"))
                for (const auto& p : t.at("plugins")) {
                    lanes::PluginDoc pl;
                    pl.id = p.value("id", std::string{});
                    pl.type = p.value("type", std::string{});
                    pl.name = p.value("name", std::string{});
                    pl.path = p.value("path", std::string{});
                    pl.presetSave = p.value("presetSave", std::string{});
                    pl.role = p.value("role", std::string{});
                    pl.enabled = p.value("enabled", true);
                    pl.irFile = p.value("irFile", std::string{});
                    pl.namFile = p.value("namFile", std::string{});
                    pl.dspGraph = p.value("dspGraph", std::string{});
                    if (p.contains("params"))
                        for (const auto& [k, v] : p.at("params").items())
                            pl.params[k] = v.get<double>();
                    // A rack instrument carries its sounds here: {symbol, note, clip} already resolved to absolute paths, turned
                    // into SamplerPlugin sounds in EditBuilder::addPlugin.
                    if (p.contains("rack") && p.at("rack").is_array())
                        for (const auto& e : p.at("rack")) {
                            lanes::RackEntry re;
                            re.symbol = e.value("symbol", std::string{});
                            re.note = e.value("note", 0);
                            re.clip = e.value("clip", std::string{});
                            re.start = e.value("start", 0.0);
                            re.length = e.value("length", 0.0);
                            pl.rack.push_back(std::move(re));
                        }
                    tr.plugins.push_back(std::move(pl));
                }

            if (t.contains("sends"))
                for (const auto& s : t.at("sends")) {
                    lanes::SendDoc sd;
                    sd.to = s.value("to", std::string{});
                    sd.level = s.value("level", 0.0);
                    sd.enabled = s.value("enabled", false);
                    tr.sends.push_back(std::move(sd));
                }

            if (t.contains("automation"))
                for (const auto& a : t.at("automation")) {
                    lanes::AutomationDoc au;
                    au.param = a.value("param", std::string{});
                    au.pluginId = a.value("pluginId", std::string{});
                    au.bipolar = a.value("bipolar", false);
                    if (a.contains("points"))
                        for (const auto& pt : a.at("points"))
                            au.points.emplace_back(pt.at(0).get<double>(), pt.at(1).get<double>());
                    tr.automation.push_back(std::move(au));
                }

            doc.tracks.push_back(std::move(tr));
        }
    }
    return doc;
}

// Totals across the doc's tracks, for the one-line [project] summary.
size_t countClips(const lanes::ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.clips.size();
    return n;
}

size_t countPlugins(const lanes::ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.plugins.size();
    return n;
}

// The 'audio-devices' reply, ASIO first. Sent on request AND after a switch, so clients learn the new current
// device the same way either time. Message-thread only — it enumerates JUCE devices.
json audioDevicesMsg(lanes::EngineHost& host) {
    json arr = json::array();
    for (const auto& d : host.listAudioDevices())
        arr.push_back({{"name", d.name},
                       {"type", d.type},
                       {"inputs", d.inputs},
                       {"outputs", d.outputs},
                       {"current", d.current},
                       {"isDefault", d.isDefault}});
    return json{{"type", "audio-devices"}, {"devices", arr}};
}

lanes::EngineHost* g_host = nullptr;   // for the signal handler

// One serialized plugin scan for the whole process: the startup warm-scan and any on-demand list or rescan
// route through here, so two child-process sweeps can't race the exts.json write. A warm cache short-circuits
// unless `force`, and a caller arriving mid-scan blocks on the mutex and then finds the cache warm.
std::vector<lanes::PluginInfo> ensurePluginsScanned(bool force) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    if (!force) {
        auto cached = lanes::loadPluginCache();
        if (!cached.empty()) return cached;   // another caller already warmed it
    }
    return lanes::scanInstalledPlugins(force);
}

// Read a ProjectDoc for one of the offline modes: from a file, or from stdin as "-". Accepts either the bare doc
// or a { "doc": {...} } envelope, since both are things a caller already has to hand. Returns false having said
// what was wrong on stderr — the caller only has to pick an exit code.
bool readDocArg(const std::string& input, lanes::ProjectDoc& out) {
    std::stringstream ss;
    if (input == "-") {
        ss << std::cin.rdbuf();
    } else {
        std::ifstream f(input);
        if (!f) {
            std::cerr << "cannot open " << input << "\n";
            return false;
        }
        ss << f.rdbuf();
    }
    json j;
    try {
        j = json::parse(ss.str());
    } catch (const std::exception& e) {
        std::cerr << "bad json: " << e.what() << "\n";
        return false;
    }
    try {
        out = docFromJson(j.contains("doc") ? j.at("doc") : j);
    } catch (const std::exception& e) {
        std::cerr << "bad project: " << e.what() << "\n";
        return false;
    }
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    // Child-process scan mode: the parent spawns us with `--scan-plugin <format> <id>` to load one plugin in
    // isolation. Runs before any server or engine setup, and exits with no port bound.
    if (argc >= 4 && std::string(argv[1]) == "--scan-plugin")
        return lanes::runPluginScanChild(argv[2], argv[3]);

    // Standalone scan mode: update the plugin cache, print a summary, exit — no server, no port bound.
    if (argc >= 2 && std::string(argv[1]) == "scan") {
        const bool force = (argc >= 3 && std::string(argv[2]) == "--force");
        return lanes::runPluginScanCli(force);
    }

    // Param-dump modes for the translator, printing sentinel-fenced JSON then exiting: `--dump-params <type>` for a
    // built-in, `--dump-params-ext <format> <id> <statefile>` for an external restored from its preset.
    if (argc >= 5 && std::string(argv[1]) == "--dump-params-ext")
        return lanes::dumpPluginParamsExternal(argv[2], argv[3], argv[4]);
    if (argc >= 3 && std::string(argv[1]) == "--dump-params")
        return lanes::dumpPluginParams(argv[2]);

    // Audio-interface enumeration: print the devices as fenced JSON and exit, opening no device.
    if (argc >= 2 && std::string(argv[1]) == "--list-audio-devices")
        return lanes::runAudioDevicesCli();

    // Offline render mode: read a ProjectDoc from a file or stdin, bounce it to wav, print a manifest, exit —
    // no server, no port bound.
    if (argc >= 2 && std::string(argv[1]) == "--render") {
        std::string input, outDir, baseDir;
        bool stems = false;
        for (int i = 2; i < argc; ++i) {
            const std::string a = argv[i];
            if (a == "--out" && i + 1 < argc) outDir = argv[++i];
            else if (a == "--base" && i + 1 < argc) baseDir = argv[++i];
            else if (a == "--stems") stems = true;
            else if (input.empty()) input = a;
        }
        if (input.empty() || outDir.empty()) {
            std::cerr << "usage: lanes-engine --render <doc.json|-> --out <dir> "
                         "[--stems] [--base <dir>]\n";
            return 2;
        }
        lanes::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return lanes::renderOffline(doc, baseDir, outDir, stems);
    }

    // Freeze mode: bounce ONE track through its own plugins to a wav, print the path, exit. The `track freeze`
    // command runs this; the doc it hands over has already had that track's gain, pan and mute — and every solo in
    // the song — neutralised, because all of those stay live on a frozen track.
    if (argc >= 2 && std::string(argv[1]) == "--freeze") {
        std::string input, outFile, baseDir, trackId;
        for (int i = 2; i < argc; ++i) {
            const std::string a = argv[i];
            if (a == "--out" && i + 1 < argc) outFile = argv[++i];
            else if (a == "--base" && i + 1 < argc) baseDir = argv[++i];
            else if (a == "--track" && i + 1 < argc) trackId = argv[++i];
            else if (input.empty()) input = a;
        }
        if (input.empty() || outFile.empty() || trackId.empty()) {
            std::cerr << "usage: lanes-engine --freeze <doc.json|-> --track <id> --out <file.wav> "
                         "[--base <dir>]\n";
            return 2;
        }
        lanes::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return lanes::freezeTrack(doc, baseDir, trackId, outFile);
    }

    // Waveform-cache mode: decode the file, write its `{file}.cache` sidecar, exit. The file service invokes this
    // to rebuild a missing or stale cache on demand.
    if (argc >= 3 && std::string(argv[1]) == "--waveform")
        return lanes::writeWaveformCache(argv[2]);

    // Normalize mode: peak-normalize the given clips with one shared gain (see NormalizeClips.cpp). The (in,out)
    // paths pair up, and the `normalize` command supplies the _norm names.
    if (argc >= 5 && std::string(argv[1]) == "--normalize") {
        const double target = std::atof(argv[2]);
        std::vector<std::pair<std::string, std::string>> pairs;
        for (int i = 3; i + 1 < argc; i += 2)
            pairs.emplace_back(argv[i], argv[i + 1]);
        return lanes::normalizeClips(target, pairs);
    }

    // Batch waveform mode: read audio paths from stdin and write every `{file}.cache` in THIS process, so a song
    // with many fresh clips pays JUCE startup once instead of per file. Prints a flushed "ok"/"err" line per file
    // so the caller can stream a live count, and one bad file never aborts the batch.
    if (argc >= 2 && std::string(argv[1]) == "--waveform-batch") {
        std::string line;
        bool first = true;
        while (std::getline(std::cin, line)) {
            // Strip a leading UTF-8 BOM some stdin encoders prepend to the first line.
            if (first && line.size() >= 3 &&
                static_cast<unsigned char>(line[0]) == 0xEF &&
                static_cast<unsigned char>(line[1]) == 0xBB &&
                static_cast<unsigned char>(line[2]) == 0xBF)
                line.erase(0, 3);
            first = false;
            if (!line.empty() && line.back() == '\r') line.pop_back();  // tolerate CRLF
            if (line.empty()) continue;
            const int rc = lanes::writeWaveformCache(line);
            std::cout << (rc == 0 ? "ok\t" : "err\t") << line << "\n" << std::flush;
        }
        return 0;
    }

    const int port = argc > 1 ? std::atoi(argv[1]) : 8765;

    // Engine identity (Phase-1 local trust): the supervisor passes a stable id and secret token by env, which we
    // echo on `whoami` — so a browser can confirm it reached THIS engine and a lookalike, not knowing the token,
    // can't impersonate it. Empty without the supervisor, and an empty id matches no selection.
    const char* idEnv = std::getenv("LANES_ENGINE_ID");
    const char* tokEnv = std::getenv("LANES_ENGINE_TOKEN");
    const std::string engineId = idEnv ? idEnv : "";
    const std::string engineToken = tokEnv ? tokEnv : "";

    // Time the startup phases: everything before the port opens is invisible to a client — it just sees a refused
    // connection — so a slow start (Tracktion building its device list, an interface still waking) is otherwise
    // undiagnosable. std::chrono, not juce::Time: this file keeps no JUCE includes.
    const auto bootT = std::chrono::steady_clock::now();
    const auto sinceBoot = [&bootT] {
        return std::chrono::duration<double, std::milli>(
                   std::chrono::steady_clock::now() - bootT)
            .count();
    };

    ix::initNetSystem();

    // Constructing the host builds the Tracktion engine but no longer opens the audio device — that is queued below
    // so the port can bind first. Opening one can take seconds, and while it did, a probing browser saw a refused
    // connection, indistinguishable from an absent engine.
    lanes::EngineHost host;
    g_host = &host;
    const double ctorMs = sinceBoot();

    // Open the audio device as the FIRST message-thread action, enqueued before any client is accepted, so it runs
    // ahead of any project apply. The port answers whoami and probes without waiting on it.
    host.post([&host, &sinceBoot, ctorMs] {
        const double t0 = sinceBoot();
        host.openAudioDevice();
        const double t1 = sinceBoot();
        std::cerr << "[startup] tracktion=" << ctorMs << "ms audioDevice="
                  << (t1 - t0) << "ms (device ready at " << t1 << "ms)\n";
        // The device setup is persisted, so a bad one survives restarts and poisons every project. With no output there
        // is no audio callback: play "works", the playhead never leaves 0, and nothing sounds. Say it once.
        if (host.outputDeviceName().empty())
            std::cerr << "warning: no audio OUTPUT device is open — the transport will "
                         "run but the playhead won't advance and nothing will sound. "
                         "Pick an output with 'lanes config --set interface'.\n";
    });

    // Loopback by default (only same-machine clients reach it); the supervisor sets LANES_ENGINE_HOST=0.0.0.0 so
    // LAN browsers can too. Only the bind interface changes — there is still no auth beyond the whoami token echo.
    const char* hostEnv = std::getenv("LANES_ENGINE_HOST");
    const std::string bindHost = (hostEnv && *hostEnv) ? hostEnv : "127.0.0.1";
    ix::WebSocketServer server(port, bindHost);

    // Broadcast a JSON message to every connected client, on the engine thread where send() is safe.
    auto broadcast = [&server](const json& j) {
        const auto payload = j.dump();
        for (auto& client : server.getClients())
            client->send(payload);
    };

    // Read-only queries that short-lived PROBE connections fire and drop: the picker's `whoami`, and the tray's
    // device, plugin and edit-plugin polls. Each opens a socket, asks one, reads the reply and closes, so announcing
    // them would bury the log in connect/disconnect pairs. A connection sending only these stays silent; the moment
    // it sends anything else it is a real client and earns its line.
    // "io-levels" is in here for the other reason: it is polled several times a second while the I/O panel is
    // open, so announcing it would print a line per frame.
    static const std::unordered_set<std::string> probeQueries = {
        "whoami", "list-audio-devices", "list-plugins", "list-edit-plugins",
        "io-levels"};

    // Which connections have earned their deferred "[client] connected" line, so a disconnect is logged only when
    // the connect was. Mutex-guarded: IXWebSocket runs each connection's callback on its own thread.
    std::mutex loggedMx;
    std::unordered_set<std::string> loggedConns;

    server.setOnClientMessageCallback(
        [&host, &broadcast, &loggedMx, &loggedConns, engineId, engineToken](
            std::shared_ptr<ix::ConnectionState> conn,
            ix::WebSocket& ws, const ix::WebSocketMessagePtr& msg) {
            // Who is talking to us: the TUI, the web backend and the CLI all connect here, and an arrival or a drop explains
            // most of what follows — a reconnect re-sends the whole project. Open is silent; the line is deferred to the
            // first real message, so probes never print one.
            if (msg->type == ix::WebSocketMessageType::Open)
                return;
            if (msg->type == ix::WebSocketMessageType::Close) {
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

            json j;
            try {
                j = json::parse(msg->str);
            } catch (const std::exception& e) {
                ws.send(json{{"type", "error"}, {"message", std::string("bad json: ") + e.what()}}.dump());
                return;
            }

            const std::string type = j.value("type", std::string{});

            // The first REAL message — anything but a supervision or probe query — earns this connection its deferred line.
            if (probeQueries.count(type) == 0) {
                bool firstReal;
                {
                    std::lock_guard<std::mutex> lk(loggedMx);
                    firstReal = loggedConns.insert(conn->getId()).second;
                }
                if (firstReal)
                    std::cerr << "[client] connected (" << conn->getRemoteIp() << ")\n";
            }

            if (type == "project") {
                lanes::ProjectDoc doc;
                try {
                    doc = docFromJson(j.at("doc"));
                } catch (const std::exception& e) {
                    ws.send(json{{"type", "error"}, {"message", std::string("bad project: ") + e.what()}}.dump());
                    return;
                }
                // Apply on the engine thread; broadcast the resulting changeset.
                host.post([&host, &broadcast, doc = std::move(doc)]() mutable {
                    // What we were asked to play. Paired with the [applied] lines and [applyFull]'s timings, the log answers all
                    // three of "what arrived", "what did the engine do", and "why did it take that long".
                    std::cerr << "[project] '" << doc.name << "' " << doc.tempo << "bpm "
                              << doc.tracks.size() << " track(s) " << countClips(doc)
                              << " clip(s) " << countPlugins(doc) << " plugin(s)\n";

                    // Say that the engine is about to go deaf: a first apply builds the edit and instantiates every plugin, seconds
                    // long, on the thread that also reads the transport. Without this a client sees a live engine ignore Play and
                    // then execute every queued click at once. Sent inside the posted lambda, so it marks when the work starts.
                    broadcast(json{{"type", "busy"}, {"busy", true}});

                    const auto changes = host.apply(doc, "");   // paths are absolute
                    json r{{"type", "applied"}, {"changes", json::array()}};
                    std::vector<std::string> described;
                    described.reserve(changes.size());
                    for (const auto& c : changes) {
                        described.push_back(lanes::describe(c));
                        r["changes"].push_back(described.back());
                    }
                    broadcast(r);

                    // The diff the engine ran — its actual decision, previously visible only to whichever client happened to be
                    // listening and never in the log. A no-op re-send says so, so "nothing happened" is distinguishable from
                    // "nothing arrived", and long changesets are capped so one apply can't bury the rest.
                    if (described.empty()) {
                        std::cerr << "[applied] no changes (project already current)\n";
                    } else {
                        constexpr size_t kMaxLogged = 12;
                        std::cerr << "[applied] " << described.size() << " change(s)\n";
                        for (size_t i = 0; i < described.size() && i < kMaxLogged; ++i)
                            std::cerr << "    " << described[i] << "\n";
                        if (described.size() > kMaxLogged)
                            std::cerr << "    … and " << (described.size() - kMaxLogged)
                                      << " more\n";
                    }
                    broadcast(json{{"type", "busy"}, {"busy", false}});
                });
            } else if (type == "flush") {
                // Forget the project (plugins, edit, diff baseline) so the next one is built from scratch. Sent when the client
                // switches projects: diffing a new song against the old is meaningless, and the old plugins must not survive.
                // The engine stays up with its audio device and scan cache.
                host.post([&host, &broadcast]() {
                    host.reset();
                    broadcast(json{{"type", "flushed"}});
                });
            } else if (type == "transport") {
                const std::string action = j.value("action", std::string{});
                const double position = j.value("position", 0.0);   // seconds; "seek" only
                const double loopStart = j.value("start", 0.0);      // seconds; "loop" only
                const double loopEnd = j.value("end", 0.0);          // seconds; "loop" only
                const bool loopOn = j.value("enabled", false);       // "loop" only
                host.post([&host, action, position, loopStart, loopEnd, loopOn] {
                    // Every transport move is a deliberate user action, so one line each is signal — and it tells you whether a
                    // silent playback problem is "the engine never got play" or "it played and you heard nothing". The 20/second
                    // state broadcast stays out of the log, where it would drown everything else.
                    std::cerr << "[transport] " << action;
                    if (action == "seek") std::cerr << " -> " << position << "s";
                    if (action == "loop")
                        std::cerr << (loopOn ? " on" : " off") << " [" << loopStart
                                  << ", " << loopEnd << "]";
                    if (action == "toggle")
                        std::cerr << " (" << (host.isPlaying() ? "playing -> stop"
                                                              : "stopped -> play") << ")";
                    std::cerr << "\n";

                    if (action == "play") host.play();
                    else if (action == "stop") host.stop();
                    else if (action == "toggle") host.isPlaying() ? host.stop() : host.play();
                    else if (action == "rewind") host.rewind();
                    else if (action == "seek") host.seek(position);
                    else if (action == "loop") host.setLoop(loopStart, loopEnd, loopOn);
                });
            } else if (type == "preview") {
                // Audition one sample over [start, start+length) seconds; length <= 0 is the whole file. Independent of the
                // transport, so it works while stopped, and the path was resolved by the file service.
                const std::string file = j.value("file", std::string{});
                const double start = j.value("start", 0.0);
                const double length = j.value("length", 0.0);
                if (! file.empty())
                    host.post([&host, file, start, length] {
                        std::cerr << "[preview] " << file << " [" << start << ", "
                                  << length << "]\n";
                        host.previewSample(file, start, length);
                    });
            } else if (type == "arm") {
                // Arm or disarm a track; omitting "armed" toggles. Session state — see EngineHost::setArmed. The reply says
                // which way it went, so the caller reports it without racing the state broadcast, and a refusal says why.
                const std::string track = j.value("track", std::string{});
                std::optional<bool> armed;
                if (j.contains("armed") && j.at("armed").is_boolean())
                    armed = j.at("armed").get<bool>();
                host.post([&host, &broadcast, track, armed] {
                    const auto r = host.setArmed(track, armed);
                    if (!r.ok) {
                        std::cerr << "[rec] refused: " << r.error << '\n';
                        broadcast(json{{"type", "error"}, {"message", r.error}});
                        return;
                    }
                    broadcast(json{{"type", "armed"}, {"track", track}, {"armed", r.armed}});
                });
            } else if (type == "record-enable") {
                // Global record enable: whether play() records the armed tracks. Omitting "enabled" toggles, and the value is
                // echoed at once so the record button lights without racing the state frame.
                const bool has = j.contains("enabled") && j.at("enabled").is_boolean();
                const std::optional<bool> want =
                    has ? std::optional<bool>(j.at("enabled").get<bool>()) : std::nullopt;
                host.post([&host, &broadcast, want] {
                    const bool on = want.value_or(!host.recordEnabled());
                    host.setRecordEnabled(on);
                    broadcast(json{{"type", "record-enabled"}, {"enabled", on}});
                });
            } else if (type == "list-plugins" || type == "rescan-plugins") {
                // list-plugins returns the cached list, scanning once if it is cold so it just works the first time;
                // rescan-plugins always refreshes. A scan spawns a child per plugin and blocks, so it runs detached.
                // Optional "filter" narrows by format substring, "force" re-scans everything.
                const std::string filter = j.value("filter", std::string{});
                const bool doScan = (type == "rescan-plugins");
                const bool force = j.value("force", false);

                // IXWebSocket send() is thread-safe, so the scan thread can broadcast too.
                auto reply = [&broadcast, filter](std::vector<lanes::PluginInfo> plugins) {
                    const auto lower = [](std::string s) {
                        for (auto& ch : s) ch = (char)std::tolower((unsigned char)ch);
                        return s;
                    };
                    const std::string want = lower(filter);
                    json arr = json::array();
                    for (const auto& p : plugins) {
                        if (!want.empty() && lower(p.format).find(want) == std::string::npos) continue;
                        arr.push_back({
                            {"name", p.name},
                            {"format", p.format},
                            {"manufacturer", p.manufacturer},
                            {"instrument", p.isInstrument},
                            {"role", p.role},
                            {"category", p.category},
                            {"id", p.identifier},
                        });
                    }
                    broadcast(json{{"type", "plugins"}, {"plugins", arr}});
                };

                // Say when a scan starts and why: it spawns a child per plugin and is by far the slowest thing the engine does,
                // so a cold cache turning a list into a minute of work otherwise looks like a hang.
                if (doScan) {
                    std::cerr << "[plugins] rescan requested" << (force ? " (force)" : "")
                              << " — scanning, this can take a while\n";
                    std::thread([reply, force] { reply(ensurePluginsScanned(force)); }).detach();
                } else {
                    auto cached = lanes::loadPluginCache();
                    // Count the EXTERNALS, not the entries. The built-ins are synthesised in code and joined to
                    // whatever the file held, so `cached` is never empty: a missing or truncated exts.json still
                    // yields ~212 built-ins, sails past an emptiness check, and logs a reassuring "212 from cache"
                    // while every VST in the project silently fails to build. That is exactly what happened here
                    // — five instruments gone from an edit whose log said the cache was fine.
                    const auto externals = std::count_if(
                        cached.begin(), cached.end(),
                        [](const lanes::PluginInfo& p) { return p.format != "internal"; });
                    if (externals == 0) {
                        std::cerr << "[plugins] no EXTERNAL plugins cached (" << cached.size()
                                  << " built-in) — scanning once to fill it, this can take a while\n";
                        std::thread([reply] { reply(ensurePluginsScanned(false)); }).detach();
                    } else {
                        std::cerr << "[plugins] " << cached.size() << " from cache (" << externals
                                  << " external)"
                                  << (filter.empty() ? std::string{}
                                                     : " (filter '" + filter + "')")
                                  << "\n";
                        reply(cached);
                    }
                }
            } else if (type == "list-edit-plugins") {
                // Snapshot the plugin instances in the loaded edit for the tray's submenu. Reads pluginsById, so it must run on
                // the message thread, and the reply is broadcast like list-audio-devices — a connection may have closed between
                // post and send, and broadcast only iterates live clients.
                host.post([&host, &broadcast] {
                    json arr = json::array();
                    for (const auto& p : host.pluginInstanceInfos())
                        arr.push_back({{"id", p.id},
                                       {"name", p.name},
                                       {"hasNativePluginUI", p.hasNativePluginUI}});
                    broadcast(json{{"type", "edit-plugins"}, {"plugins", arr}});
                });
            } else if (type == "show-native-plugin-ui") {
                // Open a plugin's native editor window (external plugins only); the id is the PluginDoc id. Message thread.
                const std::string id = j.value("id", std::string{});
                host.post([&host, id] {
                    std::cerr << "[native-plugin-ui] open '" << id << "'\n";
                    host.showNativePluginUI(id);
                });
            } else if (type == "set-plugin-param") {
                // Set one plugin parameter on the LIVE edit, for a control being dragged: `name` is its display name, `value`
                // in its native range. This does NOT persist — the client writes the value to the project on release — so an
                // interrupted drag leaves the plugin on the last value sent and the project on the old one until the next apply
                // reconciles them, which is the right trade for latency. Deliberately unlogged: it arrives at interactive rates.
                const std::string id = j.value("id", std::string{});
                const std::string name = j.value("name", std::string{});
                const double value = j.value("value", 0.0);
                host.post([&host, id, name, value] { host.setPluginParam(id, name, value); });
            } else if (type == "get-plugin-params") {
                // Every automatable parameter of a live plugin with its CURRENT value, replied as the same `plugin-params`
                // message the editor-close path broadcasts — a module's UI asks once per load. The two differ in what they
                // carry: the broadcast is a minimal preset, while this reports EVERY parameter, since a control drawn at its
                // minimum because "no value was saved" would simply be wrong. `meta` rides alongside with each range and
                // default, kept a SEPARATE object so a client reading only values stays untouched.
                const std::string id = j.value("id", std::string{});
                host.post([&host, &broadcast, id] {
                    json params = json::object();
                    json meta = json::object();
                    for (const auto& p : host.pluginParamInfos(id)) {
                        params[p.name] = p.value;
                        json m{{"min", p.min}, {"max", p.max}};
                        if (p.hasDefault)
                            m["def"] = p.def;
                        if (!p.states.empty()) {
                            json states = json::array();
                            for (const auto& [label, value] : p.states)
                                states.push_back({{"label", label}, {"value", value}});
                            m["states"] = states;
                        }
                        meta[p.name] = m;
                    }
                    broadcast(json{{"type", "plugin-params"},
                                   {"id", id},
                                   {"params", params},
                                   {"meta", meta}});
                });
            } else if (type == "list-presets") {
                // The presets a MODULE's external plugin offers — program list plus the .vstpreset files — replied as `presets`
                // for the module editor's dropdown. `module` is the name; the engine resolves it to a live instance.
                const std::string module = j.value("module", std::string{});
                host.post([&host, &broadcast, module] {
                    json arr = json::array();
                    for (const auto& p : host.listPresets(module))
                        arr.push_back({{"name", p.name},
                                       {"source", p.source},
                                       {"index", p.index},
                                       {"path", p.path}});
                    broadcast(json{{"type", "presets"}, {"module", module}, {"presets", arr}});
                });
            } else if (type == "set-preset") {
                // Load a preset into every live instance of `module` and persist it to the module's .vstpreset (a `path` picks
                // a file, else `index` a program). Persisting broadcasts preset-saved, which the brain follows.
                const std::string module = j.value("module", std::string{});
                const int index = j.value("index", -1);
                const std::string path = j.value("path", std::string{});
                host.post([&host, module, index, path] {
                    std::cerr << "[preset] " << module << " <- "
                              << (path.empty() ? ("program " + std::to_string(index)) : path)
                              << "\n";
                    host.setPreset(module, index, path);
                });
            } else if (type == "watch-plugin-params") {
                // Subscribe or unsubscribe a plugin from the live parameter stream — how a knob turned in the plugin's own
                // window reaches this client. Off by default and per-plugin, so a client asks only for what it shows.
                // The watch set is the ENGINE's, not the connection's, so a second watcher is a no-op and the last unwatch stops
                // it for everyone — the same shape as the state broadcast, and acceptable for the same reason.
                const std::string id = j.value("id", std::string{});
                const bool on = j.value("on", true);
                if (!id.empty())
                    host.post([&host, id, on] { host.watchPluginParams(id, on); });
            } else if (type == "subscribe-waveform" || type == "unsubscribe-waveform") {
                // Subscribe or unsubscribe a module's waveform tap: `id` is the PluginDoc id and `side` is input or
                // output. The tap is a transparent plugin capturing min/max envelopes at 20 Hz.
                //
                // There is deliberately no `trackIndex` any more. It used to be required, and the engine placed the
                // tap on whatever track the client named — so a client that had nothing sensible to send (the graph
                // has no track index: a chain can be a bus with no track at all) sent 0, and the tap metered the
                // FIRST track of the song. A stale engine paired with a current client did exactly that, and the
                // symptom — a waveform showing some unrelated track — reads as a bug in the display. The track is
                // now derived from the plugin (see enableWaveformTap), and an old engine handed a message without
                // the field rejects it outright: no waveform beats a confidently wrong one.
                const std::string wfId = j.value("id", std::string{});
                const std::string side = j.value("side", std::string{"output"});
                const bool subscribe = (type == "subscribe-waveform");
                if (!wfId.empty())
                    host.post([&host, wfId, side, subscribe] {
                        if (subscribe)
                            host.enableWaveformTap(wfId, side);
                        else
                            host.disableWaveformTap(wfId, side);
                    });
            } else if (type == "list-audio-devices") {
                // Enumerate audio interfaces (message thread — touches JUCE devices).
                host.post([&host, &broadcast] { broadcast(audioDevicesMsg(host)); });
            } else if (type == "io-levels") {
                // Meter the interface itself: one peak per `channels` entry, plus the master output. Asked for
                // rather than ridden on the state frame — the I/O panel is the only thing that wants it, it
                // ENABLES the devices it measures (see channelLevelsDb), and it must not cost every client 20 Hz
                // of devices nobody is looking at.
                std::vector<std::vector<int>> sets;
                for (const auto& s : j.value("channels", json::array())) {
                    std::vector<int> ch;
                    for (const auto& c : s) ch.push_back(c.get<int>());
                    sets.push_back(std::move(ch));
                }
                host.post([&host, &broadcast, sets] {
                    json levels = json::array();
                    json found = json::array();
                    for (const auto& l : host.channelLevelsDb(sets)) {
                        levels.push_back(l.db);
                        found.push_back(l.found);
                    }
                    // The device layout rides along: how the interface GROUPS its inputs is the
                    // one thing that explains a channel that exists and meters nothing.
                    json devices = json::array();
                    for (const auto& d : host.inputDevices())
                        devices.push_back({{"name", d.name},
                                           {"channels", d.channels},
                                           {"enabled", d.enabled}});
                    // …and the tuner's reading per input, on the same poll: it is the same panel asking about
                    // the same channels, and a second command would have doubled the round trips for it.
                    json pitches = json::array();
                    json clarity = json::array();
                    for (const auto& p : host.channelPitches(sets)) {
                        pitches.push_back(p.hz);
                        clarity.push_back(p.clarity);
                    }
                    broadcast(json{{"type", "io-levels"},
                                   {"inputs", levels},
                                   {"found", found},
                                   {"pitches", pitches},
                                   {"clarity", clarity},
                                   {"devices", devices},
                                   {"master", host.masterLevelDb()}});
                });
            } else if (type == "set-audio-device") {
                // Open a specific interface, replying with the new device list or an error. `deviceType` is the backend — NOT
                // "type", which is the message kind.
                const std::string name = j.value("name", std::string{});
                const std::string deviceType = j.value("deviceType", std::string{});
                host.post([&host, &broadcast, name, deviceType] {
                    // Switching the interface reopens the audio graph, which is worth a line: a device that opens slowly, or not at
                    // all, shows up as silence rather than an error anywhere else. The failure path already warns.
                    std::cerr << "[device] opening '" << name << "'"
                              << (deviceType.empty() ? std::string{} : " [" + deviceType + "]")
                              << "\n";
                    if (host.setAudioDevice(name, deviceType))
                        broadcast(audioDevicesMsg(host));
                    else
                        broadcast(json{{"type", "error"}, {"message", "audio device not available: " + name}});
                });
            } else if (type == "whoami" || type == "hello") {
                // Identity probe, replied to the ASKING socket only, so a browser tiering candidates doesn't spam every client.
                // The token proves this is the real engine for this id; the registry verifies it server-side on select.
                ws.send(json{{"type", "whoami"}, {"id", engineId}, {"token", engineToken}}.dump());
            } else {
                // A message we don't understand is version skew between brain and engine — log it here too, or the only trace
                // is an error the client may well be ignoring.
                std::cerr << "[client] unknown message type: '" << type << "'\n";
                ws.send(json{{"type", "error"}, {"message", "unknown message type: " + type}}.dump());
            }
        });

    // Push transport/meter state to all clients ~20x/second.
    host.onState([&broadcast](const lanes::EngineHost::EngineState& s) {
        json wf = json::object();
        for (const auto& [key, envelopes] : s.waveformEnvelopes) {
            json arr = json::array();
            for (const auto& e : envelopes)
                arr.push_back({{"min", e.min}, {"max", e.max}});
            wf[key] = std::move(arr);
        }
        broadcast(json{
            {"type", "state"},
            {"playing", s.playing},
            {"playhead", s.playheadSeconds},
            {"levels", s.trackLevelsDb},
            {"inputLevels", s.trackInputLevelsDb},
            {"armed", s.armedTracks},
            {"recordEnabled", s.recordEnabled},
            {"waveform", std::move(wf)},
        });
    }, 50);

    // A finished take: the file is closed and named, the brain turns it into a clip.
    host.onRecorded([&broadcast](const std::string& trackId, const std::string& file,
                                 double start, double length) {
        broadcast(json{
            {"type", "recorded"},
            {"track", trackId},
            {"file", file},
            {"start", start},     // seconds; the brain owns the tempo map
            {"length", length},
        });
    });

    // When a plugin's editor closes the engine persists its state to the module — text params when they capture it,
    // else the module's .vstpreset — and notifies clients, whose watcher reloads.
    host.onPresetSaved([&broadcast](const std::string& id, const std::string& path) {
        broadcast(json{{"type", "preset-saved"}, {"id", id}, {"path", path}});
    });
    host.onPluginParams([&broadcast](const std::string& id, const std::string& paramsJson) {
        json params = json::object();
        try {
            params = json::parse(paramsJson);
        } catch (const std::exception&) {
        }
        broadcast(json{{"type", "plugin-params"}, {"id", id}, {"params", params}});
    });
    // Watched plugins, whenever a value moves. Its own message type rather than `plugin-params`, which means
    // "persist this": a flag on one shared type would leave every consumer a forgotten check away from rewriting
    // the project file at 20 Hz.
    // Engine warnings reach the CLIENT, not just stderr. The tray adopts an engine it did
    // not spawn, so its output goes nowhere a user can see — which is how a plugin that
    // refused its model looked exactly like one that worked.
    lanes::setWarningSink([&broadcast](const lanes::Warning& w) {
        broadcast(json{{"type", "engine-warning"},
                       {"subject", w.subject},
                       {"message", w.message}});
    });

    host.onPluginParamsLive(
        [&broadcast](const std::string& id, const std::vector<std::pair<std::string, double>>& p) {
            json params = json::object();
            for (const auto& [name, value] : p)
                params[name] = value;
            broadcast(json{{"type", "plugin-params-live"}, {"id", id}, {"params", params}});
        });

    const auto res = server.listen();
    if (!res.first) {
        std::cerr << "lanes-engine: listen failed: " << res.second << "\n";
        return 1;
    }
    server.start();
    std::cerr << "lanes-engine listening on ws://" << bindHost << ":" << port
              << (engineId.empty() ? std::string{}
                                   : " (id " + engineId + ")")
              << "\n";
    std::cerr << "[startup] port bound at " << sinceBoot()
              << "ms (audio device opens on the message loop; its timing is logged "
                 "when it completes)\n";

    // Warm the plugin cache in the background at startup, so the first list-plugins never waits on a cold scan —
    // each plugin loads in a child process, and a cold sweep is the slowest thing the engine does. A no-op when
    // warm, and serialized with the on-demand path so the two can't scan at once.
    std::thread([] {
        if (lanes::loadPluginCache().empty()) {
            std::cerr << "[plugins] cache cold at startup — warming in the background, "
                         "this can take a while\n";
            ensurePluginsScanned(false);
            std::cerr << "[plugins] background warm complete\n";
        }
    }).detach();

    std::signal(SIGINT, [](int) { if (g_host) g_host->quit(); });
    std::signal(SIGTERM, [](int) { if (g_host) g_host->quit(); });

    host.run();          // blocks on the JUCE message loop until quit()

    server.stop();
    ix::uninitNetSystem();
    return 0;
}
