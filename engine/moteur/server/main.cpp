// studio-moteur — the headless audio server: a thin WebSocket bridge over studio::engine, speaking JSON.
// It parses no files — the Node brain interprets the song and sends it as a resolved ProjectDoc. This file
// includes NO JUCE/Tracktion headers: all engine threading sits behind EngineHost's post()/onState()/run().
// The message catalogue is in docs/protocol.md.

#include "../engine/Warnings.h"

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocketServer.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <set>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <EngineHost.h>   // studio::engine
#include <ProjectDiff.h>

using json = nlohmann::json;

namespace {

// --- The audio broadcast frame ------------------------------------------------
//
// The other half of packages/engine-protocol/stream.ts, and the two must agree byte for
// byte: nothing checks that they do but a listener, and a disagreement plays as noise
// rather than failing. Every constant below is named there too.

constexpr uint32_t kStreamMagic = 0x4c535452;   // "LSTR"
constexpr uint8_t kStreamVersion = 1;
constexpr size_t kStreamHeaderBytes = 32;
constexpr uint8_t kStreamCodecPcmF32 = 0;

// 480 frames = 10 ms at 48 kHz. Smaller frames would mean more syscalls for the same
// audio; larger ones would put their own duration under the latency.
constexpr size_t kBroadcastMaxFrames = 480;

// The sender wakes this often and drains everything waiting. Shorter than the frame it
// sends, so it stays ahead of production even when a wake-up runs late.
constexpr int kBroadcastTickMs = 5;

// How many frames one pass may send before yielding. 32 frames is ~320 ms of 48 kHz audio,
// against the ~240 the engine produces in one 5 ms tick — ample headroom, and the bound is
// only there to keep a pathological burst from spinning the loop.
constexpr int kBroadcastFramesPerPass = 32;

// How much may sit unsent for one listener before frames are skipped rather than queued —
// about a third of a second of stereo float32. A cheap guard, not the real protection; see
// the sender thread for why.
constexpr size_t kBroadcastMaxQueuedBytes = 512 * 1024;

// A ceiling on a session id, not a shape: naming a session is what creates it, so the only thing
// worth refusing is one long enough to be an attack on the map. sessionFor() emits "<service>:<slug
// of an email>", so real ids are tens of bytes.
constexpr size_t kMaxSessionIdBytes = 256;

// Sender thread only, so no synchronisation: it is the one thing that reads or writes it.
// Sites that belong to no message yet: startup, and the broadcast sender. Named rather
// than "" so the places still to be addressed by a real session are greppable.

uint32_t broadcastSeq = 0;

// Set by a connection thread when the first listener arrives, cleared by the sender, which
// is the only thread allowed to move the ring's read cursor. A flag rather than a direct
// call for exactly that reason.
// One sequence per session: two services' streams are two sequences, and sharing a
// counter would have each read the other's frames as its own dropped ones.
uint32_t nextSeq(const std::string& s, uint32_t by) {
    static std::map<std::string, uint32_t> seq;
    return seq[s] += by;
}

// Sessions whose first listener just arrived, so the sender skips their ring to live. A set
// rather than a flag: two services can gain their first listener in the same tick.
std::mutex arrivedMx;
std::set<std::string> arrived;

// Little-endian writes, explicitly, rather than memcpy of a struct: the wire order is part
// of the contract, and every target being little-endian today is not a reason to bake the
// host's order into it silently.
void putU32(std::string& out, size_t at, uint32_t v) {
    out[at + 0] = static_cast<char>(v & 0xff);
    out[at + 1] = static_cast<char>((v >> 8) & 0xff);
    out[at + 2] = static_cast<char>((v >> 16) & 0xff);
    out[at + 3] = static_cast<char>((v >> 24) & 0xff);
}

std::string encodeStreamFrame(const studio::EngineHost::BroadcastChunk& chunk,
                              uint32_t seq, double captureMs) {
    const int channels = studio::EngineHost::broadcastChannels();
    const size_t count = chunk.frames * static_cast<size_t>(channels);
    std::string out(kStreamHeaderBytes + count * 4, '\0');

    putU32(out, 0, kStreamMagic);
    out[4] = static_cast<char>(kStreamVersion);
    out[5] = static_cast<char>(channels);
    // 6..7 reserved, already zero
    putU32(out, 8, static_cast<uint32_t>(chunk.sampleRate));
    putU32(out, 12, static_cast<uint32_t>(chunk.frames));
    putU32(out, 16, seq);
    out[20] = static_cast<char>(kStreamCodecPcmF32);
    // 21..23 reserved, already zero
    static_assert(sizeof(double) == 8, "the header's captureMs is an IEEE-754 binary64");
    std::memcpy(&out[24], &captureMs, 8);
    if (count > 0)
        std::memcpy(&out[kStreamHeaderBytes], chunk.samples.data(), count * 4);
    return out;
}

studio::ProjectDoc docFromJson(const json& j) {
    studio::ProjectDoc doc;
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
            studio::TrackDoc tr;
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
                    studio::ClipDoc cl;
                    cl.id = c.value("id", std::string{});
                    cl.type = c.value("type", std::string{"audio"}) == "midi"
                                  ? studio::ClipType::Midi
                                  : studio::ClipType::Audio;
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
                            studio::NoteDoc nd;
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
                    studio::PluginDoc pl;
                    pl.id = p.value("id", std::string{});
                    pl.type = p.value("type", std::string{});
                    pl.name = p.value("name", std::string{});
                    pl.path = p.value("path", std::string{});
                    pl.presetSave = p.value("presetSave", std::string{});
                    pl.role = p.value("role", std::string{});
                    pl.enabled = p.value("enabled", true);
                    pl.namFile = p.value("namFile", std::string{});
                    pl.dspGraph = p.value("dspGraph", std::string{});
                    pl.sidechainFrom = p.value("sidechainFrom", std::string{});
                    if (p.contains("params"))
                        for (const auto& [k, v] : p.at("params").items())
                            pl.params[k] = v.get<double>();
                    // A rack instrument carries its sounds here: {symbol, note, clip} already resolved to absolute paths, turned
                    // into SamplerPlugin sounds in EditBuilder::addPlugin.
                    if (p.contains("rack") && p.at("rack").is_array())
                        for (const auto& e : p.at("rack")) {
                            studio::RackEntry re;
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
                    studio::SendDoc sd;
                    sd.to = s.value("to", std::string{});
                    sd.level = s.value("level", 0.0);
                    sd.enabled = s.value("enabled", false);
                    tr.sends.push_back(std::move(sd));
                }

            if (t.contains("automation"))
                for (const auto& a : t.at("automation")) {
                    studio::AutomationDoc au;
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
size_t countClips(const studio::ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.clips.size();
    return n;
}

size_t countPlugins(const studio::ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.plugins.size();
    return n;
}

// The 'audio-devices' reply, ASIO first. Sent on request AND after a switch, so clients learn the new current
// device the same way either time. Message-thread only — it enumerates JUCE devices.
json audioDevicesMsg(studio::EngineHost& host) {
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

studio::EngineHost* g_host = nullptr;   // for the signal handler

// One serialized plugin scan for the whole process: the startup warm-scan and any on-demand list or rescan
// route through here, so two child-process sweeps can't race the exts.json write. A warm cache short-circuits
// unless `force`, and a caller arriving mid-scan blocks on the mutex and then finds the cache warm.
std::vector<studio::PluginInfo> ensurePluginsScanned(bool force) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    if (!force) {
        auto cached = studio::loadPluginCache();
        if (!cached.empty()) return cached;   // another caller already warmed it
    }
    return studio::scanInstalledPlugins(force);
}

// Read a ProjectDoc for one of the offline modes: from a file, or from stdin as "-". Accepts either the bare doc
// or a { "doc": {...} } envelope, since both are things a caller already has to hand. Returns false having said
// what was wrong on stderr — the caller only has to pick an exit code.
bool readDocArg(const std::string& input, studio::ProjectDoc& out) {
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
        return studio::runPluginScanChild(argv[2], argv[3]);

    // Standalone scan mode: update the plugin cache, print a summary, exit — no server, no port bound.
    if (argc >= 2 && std::string(argv[1]) == "scan") {
        const bool force = (argc >= 3 && std::string(argv[2]) == "--force");
        return studio::runPluginScanCli(force);
    }

    // Param-dump modes for the translator, printing sentinel-fenced JSON then exiting: `--dump-params <type>` for a
    // built-in, `--dump-params-ext <format> <id> <statefile>` for an external restored from its preset.
    if (argc >= 5 && std::string(argv[1]) == "--dump-params-ext")
        return studio::dumpPluginParamsExternal(argv[2], argv[3], argv[4]);
    if (argc >= 3 && std::string(argv[1]) == "--dump-params")
        return studio::dumpPluginParams(argv[2]);

    // Audio-interface enumeration: print the devices as fenced JSON and exit, opening no device.
    if (argc >= 2 && std::string(argv[1]) == "--list-audio-devices")
        return studio::runAudioDevicesCli();

    // Offline render mode: read a ProjectDoc from a file or stdin, bounce it to wav, print a manifest, exit —
    // no server, no port bound.
    // THROWAWAY PROBE — `--multi-edit-test <doc1.json> <doc2.json> [--seconds N]`. Answers
    // whether several documents can play at once on ONE device, which decides whether N
    // services share a low-latency ASIO engine as N Edits or as N processes. Delete with
    // MultiEditTest.cpp once the answer is written down.
    if (argc >= 2 && std::string(argv[1]) == "--multi-edit-test") {
        std::vector<studio::ProjectDoc> docs;
        std::vector<std::string> baseDirs;
        double seconds = 5.0;
        std::string devName, devType;
        for (int i = 2; i < argc; ++i) {
            const std::string a = argv[i];
            if (a == "--seconds" && i + 1 < argc) { seconds = std::atof(argv[++i]); continue; }
            if (a == "--device" && i + 1 < argc) { devName = argv[++i]; continue; }
            if (a == "--device-type" && i + 1 < argc) { devType = argv[++i]; continue; }
            std::ifstream f(a);
            if (!f) {
                std::cerr << "cannot read " << a << "\n";
                return 2;
            }
            std::stringstream ss;
            ss << f.rdbuf();
            try {
                docs.push_back(docFromJson(json::parse(ss.str())));
                baseDirs.push_back("");
            } catch (const std::exception& e) {
                std::cerr << "bad doc " << a << ": " << e.what() << "\n";
                return 2;
            }
        }
        if (docs.size() < 2) {
            std::cerr << "usage: studio-moteur --multi-edit-test <doc1.json> <doc2.json> [--seconds N]\n";
            return 2;
        }
        return studio::runMultiEditTest(docs, baseDirs, seconds, devName, devType);
    }
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
            std::cerr << "usage: studio-moteur --render <doc.json|-> --out <dir> "
                         "[--stems] [--base <dir>]\n";
            return 2;
        }
        studio::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return studio::renderOffline(doc, baseDir, outDir, stems);
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
            std::cerr << "usage: studio-moteur --freeze <doc.json|-> --track <id> --out <file.wav> "
                         "[--base <dir>]\n";
            return 2;
        }
        studio::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return studio::freezeTrack(doc, baseDir, trackId, outFile);
    }

    // Waveform-cache mode: decode the file, write its `{file}.cache` sidecar, exit. The file service invokes this
    // to rebuild a missing or stale cache on demand.
    // The optional third argument is the transient detector's sensitivity (stddevs above the mean jump); omitted,
    // the built-in default applies. It is per SOURCE and lands in the sidecar, so a later read gets it back.
    if (argc >= 3 && std::string(argv[1]) == "--waveform")
        return studio::writeWaveformCache(
            argv[2], argc >= 4 ? std::atof(argv[3]) : studio::kDefaultTransientSensitivity);

    // Normalize mode: peak-normalize the given clips with one shared gain (see NormalizeClips.cpp). The (in,out)
    // paths pair up, and the `normalize` command supplies the _norm names.
    if (argc >= 5 && std::string(argv[1]) == "--normalize") {
        const double target = std::atof(argv[2]);
        std::vector<std::pair<std::string, std::string>> pairs;
        for (int i = 3; i + 1 < argc; i += 2)
            pairs.emplace_back(argv[i], argv[i + 1]);
        return studio::normalizeClips(target, pairs);
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
            // `<path>` or `<path>\t<sensitivity>`. The caller sends the sensitivity a file's PREVIOUS sidecar
            // carried, so rebuilding a stale envelope does not silently reset a threshold somebody tuned.
            std::string path = line;
            double sensitivity = studio::kDefaultTransientSensitivity;
            if (const auto tab = line.find('\t'); tab != std::string::npos) {
                path = line.substr(0, tab);
                sensitivity = std::atof(line.c_str() + tab + 1);
            }
            const int rc = studio::writeWaveformCache(path, sensitivity);
            std::cout << (rc == 0 ? "ok\t" : "err\t") << path << "\n" << std::flush;
        }
        return 0;
    }

    const int port = argc > 1 ? std::atoi(argv[1]) : 8765;

    // Engine identity (Phase-1 local trust): the supervisor passes a stable id and secret token by env, which we
    // echo on `whoami` — so a browser can confirm it reached THIS engine and a lookalike, not knowing the token,
    // can't impersonate it. Empty without the supervisor, and an empty id matches no selection.
    const char* idEnv = std::getenv("STUDIO_ENGINE_ID");
    const char* tokEnv = std::getenv("STUDIO_ENGINE_TOKEN");
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
    studio::EngineHost host;
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
                         "Pick an output with 'l8 config --set interface'.\n";
    });

    // Loopback by default (only same-machine clients reach it); the supervisor sets STUDIO_ENGINE_HOST=0.0.0.0 so
    // LAN browsers can too. Only the bind interface changes — there is still no auth beyond the whoami token echo.
    const char* hostEnv = std::getenv("STUDIO_ENGINE_HOST");
    const std::string bindHost = (hostEnv && *hostEnv) ? hostEnv : "127.0.0.1";
    ix::WebSocketServer server(port, bindHost);

    // Broadcast a JSON message to every connected client, on the engine thread where send() is safe.
    // For replies that are the MACHINE's — the device list, the installed-plugin catalogue, the
    // session list. Everything about one project goes through broadcastTo. See docs/protocol.md.
    auto broadcast = [&server](const json& j) {
        const auto payload = j.dump();
        for (auto& client : server.getClients())
            client->send(payload);
    };

    // The same, stamped with the project it is about, so a client sharing this port drops what is
    // not its own (packages/engine-protocol/sessions.ts's forSession). Two verbs rather than a
    // hand-written {"session", …} per reply: a new reply must CHOOSE one, and the choice is
    // reviewable in a word — which is the only thing that stops the next one being forgotten.
    auto broadcastTo = [&broadcast](const std::string& sid, json j) {
        j["session"] = sid;
        broadcast(j);
    };

    // Read-only queries that short-lived PROBE connections fire and drop: the picker's `whoami`, and the tray's
    // device, plugin and edit-plugin polls. Each opens a socket, asks one, reads the reply and closes, so announcing
    // them would bury the log in connect/disconnect pairs. A connection sending only these stays silent; the moment
    // it sends anything else it is a real client and earns its line.
    // "io-levels" is in here for the other reason: it is polled several times a second while the I/O panel is
    // open, so announcing it would print a line per frame.
    static const std::unordered_set<std::string> probeQueries = {
        "whoami", "list-audio-devices", "list-plugins", "list-edit-plugins",
        "list-sessions", "io-levels"};

    // Which connections have earned their deferred "[client] connected" line, so a disconnect is logged only when
    // the connect was. Mutex-guarded: IXWebSocket runs each connection's callback on its own thread.
    std::mutex loggedMx;
    std::unordered_set<std::string> loggedConns;

    // Who asked for audio. By POINTER, matched against server.getClients(), because the
    // stream is ~3 Mbit/s uncompressed and must never go to a connection that did not ask
    // — the tray polls this port several times a second on sockets it drops immediately.
    // Same mutex discipline as loggedConns: one callback thread per connection.
    std::mutex listenersMx;
    std::unordered_map<const ix::WebSocket*, std::string> listeners;

    server.setOnClientMessageCallback(
        [&host, &broadcast, &broadcastTo, &loggedMx, &loggedConns, &listenersMx, &listeners,
         engineId, engineToken](
            std::shared_ptr<ix::ConnectionState> conn,
            ix::WebSocket& ws, const ix::WebSocketMessagePtr& msg) {
            // Who is talking to us: the TUI, the web backend and the CLI all connect here, and an arrival or a drop explains
            // most of what follows — a reconnect re-sends the whole project. Open is silent; the line is deferred to the
            // first real message, so probes never print one.
            if (msg->type == ix::WebSocketMessageType::Open)
                return;
            if (msg->type == ix::WebSocketMessageType::Close) {
                // Drop the listener FIRST: a socket that closed mid-stream must stop being
                // sent to before anything else happens, and "the listener hung up" is the
                // case this whole path most needs to survive.
                //
                // And take the tap off when that was the last one. A closed tab never sends
                // {"broadcast": false}, so without this the engine would copy every block
                // and encode a frame 200 times a second for nobody, for the rest of its
                // life — with buildLevelMeters faithfully reasserting the tap on every apply.
                {
                    // The post happens UNDER the lock, so two connection threads cannot
                    // compute their wishes in one order and queue them in the other — which
                    // would let a departing listener's alse land after an arriving one's
                    // 	rue and silence a listener that is still there.
                    std::lock_guard<std::mutex> lk(listenersMx);
                    if (auto gone = listeners.find(&ws); gone != listeners.end()) {
                        const std::string sid = gone->second;
                        listeners.erase(gone);
                        // Said out loud: a listener leaving by closing its tab is the
                        // ordinary way this ends, and without a line the tap coming off is
                        // invisible — you cannot tell "stopped tapping" from "still copying
                        // every block for nobody" from the outside.
                        std::cerr << "[broadcast] listener gone from '" << sid << "' ("
                                  << listeners.size() << " listening)\n";
                        // The last ear on THAT session, not on the engine. Counting them all
                        // had a closing m9 tab take the tap off the DEFAULT session —
                        // silencing a l8 listener still there, and leaving m9's own
                        // tap copying every block for nobody.
                        const bool anyLeft =
                            std::any_of(listeners.begin(), listeners.end(),
                                        [&](const auto& e) { return e.second == sid; });
                        if (!anyLeft)
                            host.post([&host, sid] { host.enableBroadcast(sid, false); });
                    }
                }
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

            // WHICH project this message is about. Absent means the default session, so a
            // client that has never heard of sessions keeps working exactly as before —
            // which is what lets the engine grow this before the clients do.
            const std::string session = j.value("session", std::string{});
            // Naming a session is what creates it, deliberately — so there is no allowlist here,
            // only a ceiling, so a malformed client cannot grow the map without bound.
            if (session.size() > kMaxSessionIdBytes) {
                ws.send(json{{"type", "error"}, {"message", "session id too long"}}.dump());
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
            }

            if (type == "project") {
                studio::ProjectDoc doc;
                try {
                    doc = docFromJson(j.at("doc"));
                } catch (const std::exception& e) {
                    ws.send(json{{"type", "error"}, {"message", std::string("bad project: ") + e.what()}}.dump());
                    return;
                }
                // Apply on the engine thread; broadcast the resulting changeset.
                host.post([session, &host, &broadcastTo, doc = std::move(doc)]() mutable {
                    // What we were asked to play. Paired with the [applied] lines and [applyFull]'s timings, the log answers all
                    // three of "what arrived", "what did the engine do", and "why did it take that long".
                    std::cerr << "[project] '" << doc.name << "' " << doc.tempo << "bpm "
                              << doc.tracks.size() << " track(s) " << countClips(doc)
                              << " clip(s) " << countPlugins(doc) << " plugin(s)\n";

                    // Say that the engine is about to go deaf: a first apply builds the edit and instantiates every plugin, seconds
                    // long, on the thread that also reads the transport. Without this a client sees a live engine ignore Play and
                    // then execute every queued click at once. Sent inside the posted lambda, so it marks when the work starts.
                    broadcastTo(session, json{{"type", "busy"}, {"busy", true}});

                    const auto changes = host.apply(session, doc, "");   // paths are absolute
                    json r{{"type", "applied"}, {"changes", json::array()}};
                    std::vector<std::string> described;
                    described.reserve(changes.size());
                    for (const auto& c : changes) {
                        described.push_back(studio::describe(c));
                        r["changes"].push_back(described.back());
                    }
                    broadcastTo(session, r);

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
                    broadcastTo(session, json{{"type", "busy"}, {"busy", false}});
                });
            } else if (type == "broadcast") {
                // Subscribe or unsubscribe THIS connection to the master audio stream. The
                // tap is put on the master plugin list for the first listener and taken off
                // when the last one goes, so an engine nobody is listening to copies nothing.
                const bool on = j.value("on", false);
                size_t remaining = 0;
                bool first = false;
                {
                    // Same discipline as the Close handler: decide and queue under one lock.
                    std::lock_guard<std::mutex> lk(listenersMx);
                    // FIRST for THIS session — another service already listening does not make this
                    // one mid-stream. Counted rather than tested on emptiness.
                    first = on && std::none_of(listeners.begin(), listeners.end(),
                                               [&](const auto& kv) { return kv.second == session; });
                    if (on) listeners[&ws] = session;
                    else listeners.erase(&ws);
                    remaining = listeners.size();
                    if (first) { std::lock_guard<std::mutex> a(arrivedMx); arrived.insert(session); }
                    host.post([session, &host, want = remaining > 0] { host.enableBroadcast(session, want); });
                }
                std::cerr << "[broadcast] " << (on ? "listener added" : "listener removed")
                          << " (" << remaining << " listening)\n";
            } else if (type == "flush") {
                // Forget the project (plugins, edit, diff baseline) so the next one is built from scratch. Sent when the client
                // switches projects: diffing a new song against the old is meaningless, and the old plugins must not survive.
                // The engine stays up with its audio device and scan cache.
                host.post([session, &host, &broadcastTo]() {
                    host.reset(session);
                    broadcastTo(session, json{{"type", "flushed"}});
                });
            } else if (type == "transport") {
                const std::string action = j.value("action", std::string{});
                const double position = j.value("position", 0.0);   // seconds; "seek" only
                const double loopStart = j.value("start", 0.0);      // seconds; "loop" only
                const double loopEnd = j.value("end", 0.0);          // seconds; "loop" only
                const bool loopOn = j.value("enabled", false);       // "loop" only
                host.post([session, &host, action, position, loopStart, loopEnd, loopOn] {
                    // Every transport move is a deliberate user action, so one line each is signal — and it tells you whether a
                    // silent playback problem is "the engine never got play" or "it played and you heard nothing". The 20/second
                    // state broadcast stays out of the log, where it would drown everything else.
                    std::cerr << "[transport] " << action;
                    if (action == "seek") std::cerr << " -> " << position << "s";
                    if (action == "loop")
                        std::cerr << (loopOn ? " on" : " off") << " [" << loopStart
                                  << ", " << loopEnd << "]";
                    if (action == "toggle")
                        std::cerr << " (" << (host.isPlaying(session) ? "playing -> stop"
                                                              : "stopped -> play") << ")";
                    std::cerr << "\n";

                    if (action == "play") host.play(session);
                    else if (action == "stop") host.stop(session);
                    else if (action == "toggle") host.isPlaying(session) ? host.stop(session) : host.play(session);
                    else if (action == "rewind") host.rewind(session);
                    else if (action == "seek") host.seek(session, position);
                    else if (action == "loop") host.setLoop(session, loopStart, loopEnd, loopOn);
                });
            } else if (type == "preview") {
                // Audition one sample over [start, start+length) seconds; length <= 0 is the whole file. Independent of the
                // transport, so it works while stopped, and the path was resolved by the file service.
                const std::string file = j.value("file", std::string{});
                const double start = j.value("start", 0.0);
                const double length = j.value("length", 0.0);
                if (! file.empty())
                    host.post([session, &host, file, start, length] {
                        std::cerr << "[preview] " << file << " [" << start << ", "
                                  << length << "]\n";
                        host.previewSample(session, file, start, length);
                    });
            } else if (type == "arm") {
                // Arm or disarm a track; omitting "armed" toggles. Session state — see EngineHost::setArmed. The reply says
                // which way it went, so the caller reports it without racing the state broadcast, and a refusal says why.
                const std::string track = j.value("track", std::string{});
                std::optional<bool> armed;
                if (j.contains("armed") && j.at("armed").is_boolean())
                    armed = j.at("armed").get<bool>();
                host.post([session, &host, &broadcastTo, track, armed] {
                    const auto r = host.setArmed(session, track, armed);
                    if (!r.ok) {
                        std::cerr << "[rec] refused: " << r.error << '\n';
                        broadcastTo(session, json{{"type", "error"}, {"message", r.error}});
                        return;
                    }
                    broadcastTo(session, json{{"type", "armed"}, {"track", track}, {"armed", r.armed}});
                });
            } else if (type == "record-enable") {
                // This session's record enable: whether play() records its armed tracks. Omitting "enabled" toggles,
                // and the value is echoed at once so the record button lights without racing the state frame.
                const bool has = j.contains("enabled") && j.at("enabled").is_boolean();
                const std::optional<bool> want =
                    has ? std::optional<bool>(j.at("enabled").get<bool>()) : std::nullopt;
                host.post([session, &host, &broadcastTo, want] {
                    const bool on = want.value_or(!host.recordEnabled(session));
                    host.setRecordEnabled(session, on);
                    broadcastTo(session, json{{"type", "record-enabled"}, {"enabled", on}});
                });
            } else if (type == "list-plugins" || type == "rescan-plugins") {
                // list-plugins returns the cached list, scanning once if it is cold so it just works the first time;
                // rescan-plugins always refreshes. A scan spawns a child per plugin and blocks, so it runs detached.
                // Optional "filter" narrows by format substring, "force" re-scans everything.
                const std::string filter = j.value("filter", std::string{});
                const bool doScan = (type == "rescan-plugins");
                const bool force = j.value("force", false);

                // IXWebSocket send() is thread-safe, so the scan thread can broadcast too.
                auto reply = [&broadcast, filter](std::vector<studio::PluginInfo> plugins) {
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
                    auto cached = studio::loadPluginCache();
                    // Count the EXTERNALS, not the entries. The built-ins are synthesised in code and joined to
                    // whatever the file held, so `cached` is never empty: a missing or truncated exts.json still
                    // yields ~212 built-ins, sails past an emptiness check, and logs a reassuring "212 from cache"
                    // while every VST in the project silently fails to build. That is exactly what happened here
                    // — five instruments gone from an edit whose log said the cache was fine.
                    const auto externals = std::count_if(
                        cached.begin(), cached.end(),
                        [](const studio::PluginInfo& p) { return p.format != "internal"; });
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
                // Snapshot the plugin instances in EVERY session for the tray's submenu, each row naming the
                // session it is in. ENGINE-GLOBAL like list-sessions, and for the same reason: the asker is the
                // supervisor, which drives no session, and with N of them there is no "the" loaded edit. Per
                // session it would ask on the default one and get an empty list now that reading never creates.
                //
                // Reads pluginsById, so it must run on the message thread, and the reply is broadcast like
                // list-audio-devices — a connection may have closed between post and send.
                host.post([&host, &broadcast] {
                    json arr = json::array();
                    for (const auto& sid : host.sessionIds())
                        for (const auto& p : host.pluginInstanceInfos(sid))
                            arr.push_back({{"session", sid},
                                           {"id", p.id},
                                           {"name", p.name},
                                           {"hasNativePluginUI", p.hasNativePluginUI}});
                    broadcast(json{{"type", "edit-plugins"}, {"plugins", arr}});
                });
            } else if (type == "list-sessions") {
                // Every session this engine holds, for a supervisor that drives none of them.
                // ENGINE-GLOBAL on purpose — it is the one question whose answer is about the
                // other sessions, so it carries no `session` field and is not filtered.
                //
                // The listener counts come from THIS file rather than the host: who is
                // subscribed to audio is a property of the sockets, which the engine layer
                // has never seen. Snapshotted before the post so the lock is not held across
                // one, matching the discipline the sender thread already follows.
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
            } else if (type == "drop-session") {
                // Forget a session outright — the tray's way of clearing one an app left
                // behind. Documented since sessions landed and unwired until now, which is
                // worse than absent: a reader would have believed it worked.
                //
                // `session` and not an `id` field, so it addresses a session exactly like
                // every other message does.
                host.post([&host, session, &broadcast] {
                    std::cerr << "[session] dropped '" << session << "'\n";
                    host.dropSession(session);
                    broadcast(json{{"type", "session-dropped"}, {"session", session}});
                });
            } else if (type == "show-native-plugin-ui") {
                // Open a plugin's native editor window (external plugins only); the id is the PluginDoc id. Message thread.
                const std::string id = j.value("id", std::string{});
                host.post([session, &host, id] {
                    std::cerr << "[native-plugin-ui] open '" << id << "'\n";
                    host.showNativePluginUI(session, id);
                });
            } else if (type == "set-plugin-param") {
                // Set one plugin parameter on the LIVE edit, for a control being dragged: `name` is its display name, `value`
                // in its native range. This does NOT persist — the client writes the value to the project on release — so an
                // interrupted drag leaves the plugin on the last value sent and the project on the old one until the next apply
                // reconciles them, which is the right trade for latency. Deliberately unlogged: it arrives at interactive rates.
                const std::string id = j.value("id", std::string{});
                const std::string name = j.value("name", std::string{});
                const double value = j.value("value", 0.0);
                host.post([session, &host, id, name, value] { host.setPluginParam(session, id, name, value); });
            } else if (type == "get-plugin-params") {
                // Every automatable parameter of a live plugin with its CURRENT value, replied as the same `plugin-params`
                // message the editor-close path broadcasts — a module's UI asks once per load. The two differ in what they
                // carry: the broadcast is a minimal preset, while this reports EVERY parameter, since a control drawn at its
                // minimum because "no value was saved" would simply be wrong. `meta` rides alongside with each range and
                // default, kept a SEPARATE object so a client reading only values stays untouched.
                const std::string id = j.value("id", std::string{});
                host.post([session, &host, &broadcastTo, id] {
                    json params = json::object();
                    json meta = json::object();
                    for (const auto& p : host.pluginParamInfos(session, id)) {
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
                    broadcastTo(session, json{{"type", "plugin-params"},
                                              {"id", id},
                                              {"params", params},
                                              {"meta", meta}});
                });
            } else if (type == "list-presets") {
                // The presets a MODULE's external plugin offers — program list plus the .vstpreset files — replied as `presets`
                // for the module editor's dropdown. `module` is the name; the engine resolves it to a live instance.
                const std::string module = j.value("module", std::string{});
                host.post([session, &host, &broadcastTo, module] {
                    json arr = json::array();
                    for (const auto& p : host.listPresets(session, module))
                        arr.push_back({{"name", p.name},
                                       {"source", p.source},
                                       {"index", p.index},
                                       {"path", p.path}});
                    broadcastTo(session, json{{"type", "presets"}, {"module", module}, {"presets", arr}});
                });
            } else if (type == "set-preset") {
                // Load a preset into every live instance of `module` and persist it to the module's .vstpreset (a `path` picks
                // a file, else `index` a program). Persisting broadcasts preset-saved, which the brain follows.
                const std::string module = j.value("module", std::string{});
                const int index = j.value("index", -1);
                const std::string path = j.value("path", std::string{});
                host.post([session, &host, module, index, path] {
                    std::cerr << "[preset] " << module << " <- "
                              << (path.empty() ? ("program " + std::to_string(index)) : path)
                              << "\n";
                    host.setPreset(session, module, index, path);
                });
            } else if (type == "watch-plugin-params") {
                // Subscribe or unsubscribe a plugin from the live parameter stream — how a knob turned in the plugin's own
                // window reaches this client. Off by default and per-plugin, so a client asks only for what it shows.
                // The watch set is the ENGINE's, not the connection's, so a second watcher is a no-op and the last unwatch stops
                // it for everyone — the same shape as the state broadcast, and acceptable for the same reason.
                const std::string id = j.value("id", std::string{});
                const bool on = j.value("on", true);
                if (!id.empty())
                    host.post([session, &host, id, on] { host.watchPluginParams(session, id, on); });
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
                    host.post([session, &host, wfId, side, subscribe] {
                        if (subscribe)
                            host.enableWaveformTap(session, wfId, side);
                        else
                            host.disableWaveformTap(session, wfId, side);
                    });
            } else if (type == "list-audio-devices") {
                // Enumerate audio interfaces (message thread — touches JUCE devices).
                host.post([session, &host, &broadcast] { broadcast(audioDevicesMsg(host)); });
            } else if (type == "io-levels") {
                // Meter the interface itself: one peak per `channels` entry, plus the master output. Asked for
                // rather than ridden on the state frame — the I/O panel is the only thing that wants it, and the
                // pitch estimate below is real work per channel, so it must not cost every client 20 Hz of
                // channels nobody is looking at. It no longer ENABLES anything: see channelLevelsDb.
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
                    // Stamped because "master" is this session's own output level: unstamped, two I/O
                    // panels on one engine read each other's meter.
                    broadcastTo(session, json{{"type", "io-levels"},
                                              {"inputs", levels},
                                              {"found", found},
                                              {"pitches", pitches},
                                              {"clarity", clarity},
                                              {"devices", devices},
                                              {"master", host.masterLevelDb(session)}});
                });
            } else if (type == "set-audio-device") {
                // Open a specific interface, replying with the new device list or an error. `deviceType` is the backend — NOT
                // "type", which is the message kind.
                const std::string name = j.value("name", std::string{});
                const std::string deviceType = j.value("deviceType", std::string{});
                host.post([session, &host, &broadcast, &broadcastTo, name, deviceType] {
                    // Switching the interface reopens the audio graph, which is worth a line: a device that opens slowly, or not at
                    // all, shows up as silence rather than an error anywhere else. The failure path already warns.
                    std::cerr << "[device] opening '" << name << "'"
                              << (deviceType.empty() ? std::string{} : " [" + deviceType + "]")
                              << "\n";
                    // The new device list goes to EVERYONE — one interface per process, so every session
                    // must learn a switch. The refusal goes only to whoever asked for it.
                    if (host.setAudioDevice(name, deviceType))
                        broadcast(audioDevicesMsg(host));
                    else
                        broadcastTo(session, json{{"type", "error"}, {"message", "audio device not available: " + name}});
                });
            } else if (type == "whoami" || type == "hello") {
                // Identity probe, replied to the ASKING socket only, so a browser measuring candidates doesn't spam every
                // client. The token proves this is the real engine for this id; the registry verifies it server-side on select.
                //
                // It carries the audio timing too, because the browser is timing THIS round trip to get the network half
                // and needs the interface half from the same breath — a second query would measure a second, warmer trip.
                // Answered off the message thread deliberately: posting it would put the probe behind whatever the engine
                // is doing, turning the ping into a measure of its queue. That is only SAFE because audioTiming() reads
                // two atomics the message thread publishes — it used to dereference the live device, which a concurrent
                // set-audio-device destroys, and this keepalive fires every few seconds on every socket.
                const auto timing = host.audioTiming();
                ws.send(json{{"type", "whoami"},
                             {"id", engineId},
                             {"token", engineToken},
                             {"bufferSize", timing.bufferFrames},
                             {"sampleRate", timing.sampleRate}}
                            .dump());
            } else {
                // A message we don't understand is version skew between brain and engine — log it here too, or the only trace
                // is an error the client may well be ignoring.
                std::cerr << "[client] unknown message type: '" << type << "'\n";
                ws.send(json{{"type", "error"}, {"message", "unknown message type: " + type}}.dump());
            }
        });

    // Push transport/meter state to all clients ~20x/second.
    host.onState([&broadcast](const studio::EngineHost::EngineState& s) {
        json wf = json::object();
        for (const auto& [key, envelopes] : s.waveformEnvelopes) {
            json arr = json::array();
            for (const auto& e : envelopes)
                arr.push_back({{"min", e.min}, {"max", e.max}});
            wf[key] = std::move(arr);
        }
        broadcast(json{
            {"type", "state"},
            // WHICH project this frame describes. Empty is the default session — what a
            // client that never asked for one drives.
            {"session", s.session},
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

    // When a plugin's editor closes the engine persists its state to the module — text params when they capture it,
    // else the module's .vstpreset — and notifies clients, whose watcher reloads.
    host.onPresetSaved([&broadcastTo](const std::string& session, const std::string& id,
                                      const std::string& path) {
        broadcastTo(session, json{{"type", "preset-saved"}, {"id", id}, {"path", path}});
    });
    host.onPluginParams([&broadcastTo](const std::string& session, const std::string& id,
                                       const std::string& paramsJson) {
        json params = json::object();
        try {
            params = json::parse(paramsJson);
        } catch (const std::exception&) {
        }
        broadcastTo(session, json{{"type", "plugin-params"}, {"id", id}, {"params", params}});
    });
    // Watched plugins, whenever a value moves. Its own message type rather than `plugin-params`, which means
    // "persist this": a flag on one shared type would leave every consumer a forgotten check away from rewriting
    // the project file at 20 Hz.
    // Engine warnings reach the CLIENT, not just stderr. The tray adopts an engine it did
    // not spawn, so its output goes nowhere a user can see — which is how a plugin that
    // refused its model looked exactly like one that worked.
    // Stamped when a WarningScope named a project (an apply, a preset load); unstamped otherwise —
    // a device or startup warning belongs to no session, which is the case pass-on-absence covers.
    studio::setWarningSink([&broadcast, &broadcastTo](const studio::Warning& w) {
        json msg{{"type", "engine-warning"}, {"subject", w.subject}, {"message", w.message}};
        if (w.session.empty()) broadcast(msg);
        else broadcastTo(w.session, msg);
    });

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
        std::cerr << "studio-moteur: listen failed: " << res.second << "\n";
        return 1;
    }
    server.start();

    // The audio broadcast: drain the master tap and push it to whoever asked, as BINARY on
    // this same socket.
    //
    // ITS OWN THREAD, and that is not a preference. For a SERVER-side socket IXWebSocket
    // sets _blockingSend, and WebSocketServer leaves its send timeout at -1: sendBinary
    // does not return until the listener's TCP window drains, with no bound. On the message
    // thread — where this started — one suspended laptop would park the whole engine: no
    // meters, no transport, no applies, and it would read as a hang with no cause.
    //
    // What this does NOT fix, and is worth knowing before trusting it: the JSON broadcast()
    // above still sends from the message thread, and IXWebSocket takes a per-socket write
    // mutex for the whole of a send. So a listener wedged here still stalls the 20 Hz state
    // frame behind that mutex. That hazard predates the audio stream — any client could
    // always do it — but a 3 Mbit/s subscriber makes it likely rather than theoretical, and
    // fixing it means giving the JSON path a bounded send too. Measure it (docs/broadcast.md)
    // before deciding.
    //
    // The bufferedAmount() guard below is a cheap check, not the protection: after a
    // blocking send returns the tx buffer is empty, so it reads ~0 nearly every time.
    std::atomic<bool> senderRunning{true};
    std::thread senderThread([&host, &server, &listenersMx, &listeners, &sinceBoot,
                              &senderRunning] {
        bool warnedNoRate = false;

        // Drain ONE session's ring and send it to ONE session's listeners. A lambda rather
        // than inline, because the pass below loops over sessions and the per-session work
        // is what has to stay readable.
        const auto pump =
            [&](const std::string& sid,
                const std::vector<std::shared_ptr<ix::WebSocket>>& targets) {
                // Drain everything waiting, not one frame per pass. A ceiling equal to the
                // production rate has NO headroom: any late wake-up adds backlog no later
                // pass can work off, so the ring fills within a second and stays full. The
                // bound only stops a burst spinning the loop.
                for (int guard = 0; guard < kBroadcastFramesPerPass; ++guard) {
                    auto chunk = host.drainBroadcast(sid, kBroadcastMaxFrames);
                    if (chunk.frames == 0) break;

                    // A rate of 0 means this session's tap has never been through
                    // initialise(). stream.ts rejects it, so it would vanish in silence.
                    if (chunk.sampleRate < 8000.0) {
                        if (!warnedNoRate) {
                            std::cerr << "[broadcast] a tap has no sample rate yet — frames "
                                         "withheld until the graph has prepared it\n";
                            warnedNoRate = true;
                        }
                        break;
                    }

                    // A hole the tap overwrote becomes a JUMP in the sequence number, so the
                    // listener re-cushions instead of splicing unrelated samples. Rounded
                    // UP: integer division would report a sub-frame hole as no hole at all.
                    const uint32_t seq =
                        nextSeq(sid, 1 + static_cast<uint32_t>(
                                              (chunk.lostFrames + kBroadcastMaxFrames - 1) /
                                              kBroadcastMaxFrames));
                    const auto payload = encodeStreamFrame(chunk, seq, sinceBoot());

                    // Sent OUTSIDE the listener lock — see the note above: this send blocks,
                    // and holding the lock would stall every connection thread reaching the
                    // Close handler. The shared_ptrs keep the sockets alive across it.
                    for (auto& client : targets) {
                        if (client->bufferedAmount() > kBroadcastMaxQueuedBytes) continue;
                        client->sendBinary(payload);
                    }
                    if (chunk.frames < kBroadcastMaxFrames) break;   // ring is empty
                }
            };

        while (senderRunning.load(std::memory_order_relaxed)) {
            // A session whose first listener just arrived starts from LIVE. Honoured here
            // because moving a read cursor belongs to this thread alone.
            {
                std::set<std::string> justArrived;
                {
                    std::lock_guard<std::mutex> a(arrivedMx);
                    justArrived.swap(arrived);
                }
                for (const auto& sid : justArrived) host.skipBroadcastToLive(sid);
            }

            // WHO IS LISTENING TO WHAT. The whole point of this pass: a session's audio goes
            // only to the sockets driving that session. Before, every listener got the one
            // global master — an st0 module preview would have been mixed into a set.
            std::map<std::string, std::vector<std::shared_ptr<ix::WebSocket>>> bySession;
            {
                const auto clients = server.getClients();
                std::lock_guard<std::mutex> lk(listenersMx);
                // Prune the departed FIRST. The map is keyed by raw pointer, so an entry
                // left by a connection whose Close never arrived could be matched by a later
                // socket the allocator put at the same address — handing a tray probe a
                // 3 Mbit/s stream it never asked for.
                for (auto it = listeners.begin(); it != listeners.end();) {
                    const bool live = std::any_of(
                        clients.begin(), clients.end(),
                        [&](const std::shared_ptr<ix::WebSocket>& c) {
                            return c.get() == it->first;
                        });
                    it = live ? std::next(it) : listeners.erase(it);
                }
                for (auto& client : clients)
                    if (auto hit = listeners.find(client.get()); hit != listeners.end())
                        bySession[hit->second].push_back(client);
            }

            for (const auto& [sid, targets] : bySession) pump(sid, targets);
            std::this_thread::sleep_for(std::chrono::milliseconds(kBroadcastTickMs));
        }
    });

    std::cerr << "studio-moteur listening on ws://" << bindHost << ":" << port
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
        if (studio::loadPluginCache().empty()) {
            std::cerr << "[plugins] cache cold at startup — warming in the background, "
                         "this can take a while\n";
            ensurePluginsScanned(false);
            std::cerr << "[plugins] background warm complete\n";
        }
    }).detach();

    std::signal(SIGINT, [](int) { if (g_host) g_host->quit(); });
    std::signal(SIGTERM, [](int) { if (g_host) g_host->quit(); });

    host.run();          // blocks on the JUCE message loop until quit()

    // server.stop() FIRST, then join. The sender can be parked in a send to a listener that
    // stopped reading, and that send has no timeout — the only thing that unwedges it is
    // the socket being closed, which is what stop() does. Joining first would hang the
    // engine on Ctrl-C until the TCP stack gave up on its own.
    senderRunning.store(false, std::memory_order_relaxed);
    server.stop();
    senderThread.join();

    ix::uninitNetSystem();
    return 0;
}
