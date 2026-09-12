// st0-engine — the headless audio server: a thin WebSocket bridge over studio::engine, speaking JSON.
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
#include <map>
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

// --- The audio broadcast frame: the other half of packages/engine-protocol/stream.ts, byte for byte — only a listener checks, and a disagreement plays as noise ---

constexpr uint32_t kStreamMagic = 0x4c535452;   // "LSTR"
constexpr uint8_t kStreamVersion = 1;
constexpr size_t kStreamHeaderBytes = 32;
constexpr uint8_t kStreamCodecPcmF32 = 0;

// 480 frames = 10 ms at 48 kHz: smaller means more syscalls for the same audio, larger puts its own duration under the latency.
constexpr size_t kBroadcastMaxFrames = 480;

// The sender wakes this often and drains everything waiting — shorter than the frame it sends, so it stays ahead of a late wake-up.
constexpr int kBroadcastTickMs = 5;

// How many frames one pass may send before yielding: 32 is ~320 ms of 48 kHz audio against the ~240 one 5 ms tick produces, a bound only against a pathological burst.
constexpr int kBroadcastFramesPerPass = 32;

// How much may sit unsent for one listener before frames are skipped, about a third of a second of stereo float32 — a cheap guard, not the real protection (see the sender thread).
constexpr size_t kBroadcastMaxQueuedBytes = 512 * 1024;

// A ceiling on a session id, not a shape: naming one creates it, so only a length that attacks the map is worth refusing — real ids are tens of bytes.
constexpr size_t kMaxSessionIdBytes = 256;

// Sender thread only, so no synchronisation: it is the one thing that reads or writes any of this.

// One sequence per session: sharing a counter would have each service read the other's frames as its own dropped ones.
std::map<std::string, uint32_t> broadcastSeq;

uint32_t nextSeq(const std::string& s, uint32_t by) {
    return broadcastSeq[s] += by;
}

// Drop the counters of sessions nobody is listening to any more: naming a session creates it, so a client cycling ids would otherwise grow this map for the life of the engine.
void forgetSeqsExcept(const std::set<std::string>& live) {
    for (auto it = broadcastSeq.begin(); it != broadcastSeq.end();)
        it = live.count(it->first) ? std::next(it) : broadcastSeq.erase(it);
}

// Sessions whose first listener just arrived, so the sender — the only thread that may move the ring's read cursor — skips to live; a set, since two can arrive in one tick.
std::mutex arrivedMx;
std::set<std::string> arrived;

// Little-endian writes explicitly, rather than memcpy of a struct: the wire order is part of the contract, and not the host's to bake in silently.
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

// ONE track, split out of docFromJson so the `tracks` delta reads a track exactly as a whole document does.
studio::TrackDoc trackFromJson(const json& t);

// One plugin off the wire, shared by a TRACK's list and the MASTER chain's so the two cannot drift.
studio::PluginDoc pluginFromJson(const json& p) {
    studio::PluginDoc pl;
    pl.id = p.value("id", std::string{});
    pl.type = p.value("type", std::string{});
    pl.name = p.value("name", std::string{});
    pl.path = p.value("path", std::string{});
    pl.presetSave = p.value("presetSave", std::string{});
    pl.role = p.value("role", std::string{});
    pl.enabled = p.value("enabled", true);
    pl.namFile = p.value("namFile", std::string{});
    pl.deckFile = p.value("deckFile", std::string{});
    pl.dspGraph = p.value("dspGraph", std::string{});
    pl.faustDsp = p.value("faustDsp", std::string{});
    pl.sidechainFrom = p.value("sidechainFrom", std::string{});
    if (p.contains("params"))
        for (const auto& [k, v] : p.at("params").items())
            pl.params[k] = v.get<double>();
    // A rack instrument's sounds: {symbol, note, clip} already absolute, turned into SamplerPlugin sounds in EditBuilder::addPlugin.
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
    return pl;
}

studio::ProjectDoc docFromJson(const json& j) {
    studio::ProjectDoc doc;
    doc.name = j.value("name", std::string{"untitled"});
    doc.tempo = j.value("tempo", 120.0);
    doc.sampleRate = j.value("sampleRate", 48000);
    doc.timeSigNumerator = j.value("timeSigNumerator", 4);
    doc.timeSigDenominator = j.value("timeSigDenominator", 4);
    // Unity for a doc that does not carry the field.
    doc.masterVolume = j.value("masterVolume", 0.0f);
    // The master chain; absent means the mixer's sum reaches the interface unprocessed.
    if (j.contains("masterPlugins") && j.at("masterPlugins").is_array())
        for (const auto& p : j.at("masterPlugins"))
            doc.masterPlugins.push_back(pluginFromJson(p));
    doc.recordDir = j.value("recordDir", std::string{});
    // Project settings ride in a nested `settings` object; the engine reads only what it plays, and absent means the defaults.
    if (j.contains("settings") && j.at("settings").is_object()) {
        const auto& s = j.at("settings");
        doc.metronome = s.value("metronome", false);
        // 0.6 for a document that does not carry the field — Tracktion's own default.
        doc.metronomeLevel = s.value("metronomeLevel", 0.6);
        doc.countIn = s.value("countIn", 0);
    }

    if (j.contains("tracks"))
        for (const auto& t : j.at("tracks")) doc.tracks.push_back(trackFromJson(t));
    return doc;
}

studio::TrackDoc trackFromJson(const json& t) {
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
    // Where it LEAVES by; absent and empty both mean the mixer's sum, which is what every track but a cue bus wants.
    if (t.contains("outputChannels"))
        for (const auto& ch : t.at("outputChannels"))
            if (ch.is_number_integer() && ch.get<int>() > 0)
                tr.outputChannels.push_back(ch.get<int>());

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
                    // A pad's effects; absent == none, and not clamped since everything downstream tests for >= 2.
                    nd.repeat = n.value("repeat", 0);
                    nd.skip = n.value("skip", 0);
                    cl.notes.push_back(nd);
                }
            tr.clips.push_back(std::move(cl));
        }

    if (t.contains("plugins"))
        for (const auto& p : t.at("plugins")) tr.plugins.push_back(pluginFromJson(p));

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

    return tr;
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

// The 'audio-devices' reply, ASIO first, sent on request AND after a switch so clients learn the same way; message-thread only.
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

// One serialized plugin scan for the whole process, so two child-process sweeps cannot race the exts.json write; a warm cache short-circuits unless `force`.
std::vector<studio::PluginInfo> ensurePluginsScanned(bool force) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    if (!force) {
        auto cached = studio::loadPluginCache();
        if (!cached.empty()) return cached;   // another caller already warmed it
    }
    return studio::scanInstalledPlugins(force);
}

// Read a ProjectDoc for an offline mode — a file or "-" for stdin, bare or in a { "doc": … } envelope; false means the reason is already on stderr.
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
    studio::installCrashHandler();

    // A half-rebuilt engine LINKS and dies later on a garbage `doc.tracks`, so ask each reader what it was built against (AGENTS.md).
    {
        const std::size_t here = studio::modelLayoutHere();
        const std::size_t inDiff = studio::modelLayoutInDiff();
        const std::size_t inBuilder = studio::modelLayoutInBuilder();
        if (here != inDiff || here != inBuilder) {
            std::cerr << "[fatal] this engine is HALF REBUILT: ProjectDoc has a different layout in "
                      << "different objects (server=" << here << " diff=" << inDiff
                      << " builder=" << inBuilder << ").\n"
                      << "        It would crash on the first project, in keyOf, naming nothing.\n"
                      << "        Delete the objects for engine/*.cpp and rebuild — engine/st0-engine/AGENTS.md.\n";
            return 4;
        }
    }

    // Child-process scan mode: `--scan-plugin <format> <id>` loads one plugin in isolation, before any engine setup and with no port bound.
    if (argc >= 4 && std::string(argv[1]) == "--scan-plugin")
        return studio::runPluginScanChild(argv[2], argv[3]);

    // Standalone scan mode: update the plugin cache, print a summary, exit — no server, no port bound.
    if (argc >= 2 && std::string(argv[1]) == "scan") {
        const bool force = (argc >= 3 && std::string(argv[2]) == "--force");
        return studio::runPluginScanCli(force);
    }

    // Param-dump modes for the translator, printing sentinel-fenced JSON then exiting: `--dump-params <type>`, or `--dump-params-ext <format> <id> <statefile>` for an external restored from its preset.
    if (argc >= 5 && std::string(argv[1]) == "--dump-params-ext")
        return studio::dumpPluginParamsExternal(argv[2], argv[3], argv[4]);
    if (argc >= 3 && std::string(argv[1]) == "--dump-params")
        return studio::dumpPluginParams(argv[2]);
    // …and every built-in's FULL list — what a type has, not what an instance changed. See EngineHost.h.
    if (argc >= 2 && std::string(argv[1]) == "--dump-builtin-params")
        return studio::dumpBuiltinParams();

    // Audio-interface enumeration: print the devices as fenced JSON and exit, opening no device.
    if (argc >= 2 && std::string(argv[1]) == "--list-audio-devices")
        return studio::runAudioDevicesCli();

    // THROWAWAY PROBE `--multi-edit-test <doc1.json> <doc2.json> [--seconds N]`: can several documents play at once on ONE device? Delete with MultiEditTest.cpp once the answer is written down.
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
            std::cerr << "usage: st0-engine --multi-edit-test <doc1.json> <doc2.json> [--seconds N]\n";
            return 2;
        }
        return studio::runMultiEditTest(docs, baseDirs, seconds, devName, devType);
    }
    // Offline render mode: read a ProjectDoc from a file or stdin, bounce it to wav, print a manifest, exit — no server, no port bound.
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
            std::cerr << "usage: st0-engine --render <doc.json|-> --out <dir> "
                         "[--stems] [--base <dir>]\n";
            return 2;
        }
        studio::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return studio::renderOffline(doc, baseDir, outDir, stems);
    }

    // Freeze mode: bounce ONE track through its own plugins to a wav — `track freeze` hands over a doc with that track's gain, pan, mute and every solo already neutralised, since all of those stay live on a frozen track.
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
            std::cerr << "usage: st0-engine --freeze <doc.json|-> --track <id> --out <file.wav> "
                         "[--base <dir>]\n";
            return 2;
        }
        studio::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return studio::freezeTrack(doc, baseDir, trackId, outFile);
    }

    // Waveform-cache mode: decode the file, write its `{file}.cache` sidecar, exit — the file service invokes it to rebuild a missing or stale cache.

    // The optional third argument is the transient detector's sensitivity (stddevs above the mean jump), per SOURCE and stored in the sidecar so a later read gets it back.
    if (argc >= 3 && std::string(argv[1]) == "--waveform")
        return studio::writeWaveformCache(
            argv[2], argc >= 4 ? std::atof(argv[3]) : studio::kDefaultTransientSensitivity);

    // Peak mode: one file's true peak, the measuring half of a COLD module — the brain writes the number back into the module's `Peak` before rendering through it.
    if (argc >= 3 && std::string(argv[1]) == "--peak") return studio::printFilePeak(argv[2]);

    // No `--normalize` mode: normalising is a treatment, and a treatment is a chain the brain bounces material through with `--render` (packages/commands/docs/processChain.md).

    // Batch waveform mode: paths from stdin, every `{file}.cache` written in THIS process so JUCE starts once — a flushed ok/err line per file, and one bad file never aborts the batch.
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
            // `<path>` or `<path>\t<sensitivity>` — the caller resends what the PREVIOUS sidecar carried, so a rebuild never resets a tuned threshold.
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
                         "Pick an output with 'st0 config --set interface'.\n";
    });

    // Loopback by default; the supervisor sets STUDIO_ENGINE_HOST=0.0.0.0 for LAN browsers — only the bind interface changes, and there is still no auth beyond the whoami token echo.
    const char* hostEnv = std::getenv("STUDIO_ENGINE_HOST");
    const std::string bindHost = (hostEnv && *hostEnv) ? hostEnv : "127.0.0.1";
    ix::WebSocketServer server(port, bindHost);

    // Broadcast to every connected client, on the engine thread where send() is safe — for the MACHINE's replies only, a project's going through broadcastTo (docs/protocol.md).
    auto broadcast = [&server](const json& j) {
        const auto payload = j.dump();
        for (auto& client : server.getClients())
            client->send(payload);
    };

    // The same, stamped with the project it is about so a client sharing this port drops what is not its own — two verbs, so a new reply must CHOOSE one in a reviewable word.
    auto broadcastTo = [&broadcast](const std::string& sid, json j) {
        j["session"] = sid;
        broadcast(j);
    };

    // Read-only queries a short-lived PROBE fires and drops, plus `io-levels`, polled several times a second: announcing them would bury the log, so a connection sending only these stays silent.
    static const std::unordered_set<std::string> probeQueries = {
        "whoami", "list-audio-devices", "list-plugins", "list-edit-plugins",
        "list-sessions", "io-levels"};

    // Verbs whose `session` names ANOTHER project than the sender's, so they must not bind one: the binding is
    // once per socket, and a tray whose first message is `drop-session` would be deaf to its own for ever.
    static const std::unordered_set<std::string> overrideQueries = {
        "drop-session", "show-native-plugin-ui", "show-native-plugin-ui-of"};

    // Which connections earned their deferred "[client] connected" line, so a disconnect logs only when the connect did; mutex-guarded, since IXWebSocket runs each callback on its own thread.
    std::mutex loggedMx;
    std::unordered_set<std::string> loggedConns;

    // Who asked for audio, by POINTER matched against server.getClients(): the stream is ~3 Mbit/s uncompressed and must never reach a connection that did not ask.
    std::mutex listenersMx;
    std::unordered_map<const ix::WebSocket*, std::string> listeners;

    // Which sockets DRIVE a session — a surface somebody is looking at, declared on hello with `{"role":"driver"}`, at most one session each (docs/sessions.md).
    std::unordered_map<const ix::WebSocket*, std::string> drivers;

    // WHICH project each socket is about, learned from its first REAL message and bound ONCE, so the 20 Hz state frame reaches only the sockets that asked (docs/protocol.md).
    std::unordered_map<const ix::WebSocket*, std::string> subscribers;

    // Named rather than passed inline, so the registration below can wrap it in the one try/catch this socket has — see there.
    auto onMessage =
        [&host, &broadcast, &broadcastTo, &loggedMx, &loggedConns, &listenersMx, &listeners,
         &drivers, &subscribers, engineId, engineToken](
            std::shared_ptr<ix::ConnectionState> conn,
            ix::WebSocket& ws, const ix::WebSocketMessagePtr& msg) {
            // Who is talking to us — an arrival or a drop explains most of what follows, since a reconnect re-sends the whole project; the line is deferred to the first real message so probes never print one.
            if (msg->type == ix::WebSocketMessageType::Open)
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
                        // The last ear on THAT session, not on the engine: counting them all had a closing m9 tab take the tap off the DEFAULT session, silencing an st0 listener still there.
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

            // WHICH project this message is about; absent means the default session, so a client that never heard of sessions keeps working exactly as before.
            const std::string session = j.value("session", std::string{});
            // Naming a session is what creates it, so there is no allowlist — only a ceiling, so a malformed client cannot grow the map without bound.
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
                // …and says which project to send it state about; a probe never asks, so 20 frames a second aimed at it would be pure copy.
                if (overrideQueries.count(type) == 0) {
                    bool joined;
                    {
                        std::lock_guard<std::mutex> lk(listenersMx);
                        joined = subscribers.emplace(&ws, session).second;
                    }
                    // A NEW subscriber holds none of the take being recorded, and the frames carry
                    // only what is new — so the next one carries the whole picture (docs/recorder.md).
                    if (joined)
                        host.post([&host, session] { host.rewindRecorderEnvelopes(session); });
                }
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
                    // What we were asked to play: with the [applied] lines and [applyFull]'s timings, the log answers "what arrived", "what did the engine do" and "why so long".
                    std::cerr << "[project] '" << doc.name << "' " << doc.tempo << "bpm "
                              << doc.tracks.size() << " track(s) " << countClips(doc)
                              << " clip(s) " << countPlugins(doc) << " plugin(s)\n";

                    // Say that the engine is about to go deaf — a first apply instantiates every plugin, seconds long, on the thread that reads the transport; sent inside the lambda so it marks when the work starts.
                    broadcastTo(session, json{{"type", "busy"}, {"busy", true}});

                    // Timed whichever path it takes: `[applyFull]` prints its own phases, but an INCREMENTAL apply — the common one — has only this number (std::chrono, this being the JUCE-free half).
                    const auto applyT0 = std::chrono::steady_clock::now();
                    const auto changes = host.apply(session, doc, "");   // paths are absolute
                    const double applyMs =
                        std::chrono::duration<double, std::milli>(
                            std::chrono::steady_clock::now() - applyT0)
                            .count();
                    json r{{"type", "applied"}, {"changes", json::array()}};
                    std::vector<std::string> described;
                    described.reserve(changes.size());
                    for (const auto& c : changes) {
                        described.push_back(studio::describe(c));
                        r["changes"].push_back(described.back());
                    }
                    broadcastTo(session, r);

                    // The diff the engine ran, in the LOG rather than only at whichever client is listening: a no-op re-send says so, and long changesets are capped so one apply cannot bury the rest.
                    if (described.empty()) {
                        std::cerr << "[applied] no changes (project already current)\n";
                    } else {
                        constexpr size_t kMaxLogged = 12;
                        std::cerr << "[applied] " << described.size() << " change(s) in "
                                  << applyMs << "ms\n";
                        for (size_t i = 0; i < described.size() && i < kMaxLogged; ++i)
                            std::cerr << "    " << described[i] << "\n";
                        if (described.size() > kMaxLogged)
                            std::cerr << "    … and " << (described.size() - kMaxLogged)
                                      << " more\n";
                    }
                    broadcastTo(session, json{{"type", "busy"}, {"busy", false}});
                });
            } else if (type == "tracks") {
                // REPLACE these tracks in the document this session already holds, then run the same apply — 3.7 KB against 137 KB, and an unknown id is a disagreement, not an append (docs/protocol.md).
                std::vector<studio::TrackDoc> tracks;
                try {
                    for (const auto& t : j.at("tracks"))
                        tracks.push_back(trackFromJson(t));
                } catch (const std::exception& e) {
                    ws.send(json{{"type", "error"},
                                 {"message", std::string("bad tracks: ") + e.what()}}
                                .dump());
                    return;
                }
                host.post([session, &host, &broadcastTo,
                           tracks = std::move(tracks)]() mutable {
                    studio::ProjectDoc doc = host.current(session);
                    if (doc.tracks.empty()) {
                        broadcastTo(session,
                                    json{{"type", "error"},
                                         {"message", "tracks: this session holds no project"}});
                        return;
                    }
                    size_t unknown = 0;
                    for (auto& t : tracks) {
                        const auto it = std::find_if(
                            doc.tracks.begin(), doc.tracks.end(),
                            [&](const studio::TrackDoc& x) { return x.id == t.id; });
                        if (it == doc.tracks.end()) {
                            ++unknown;
                            continue;
                        }
                        *it = std::move(t);
                    }
                    if (unknown > 0) {
                        // Stamped, so the surface driving THIS project is the one told.
                        studio::WarningScope scoped(session);
                        studio::warn(std::to_string(unknown) +
                                         " track(s) named in an update this project does not "
                                         "hold — the whole document has to be re-sent",
                                     "tracks");
                    }
                    // No `busy` and no `applied`: this path is incremental by construction, and announcing six times a second would drown the changeset that matters.
                    host.apply(session, doc, "");
                });
            } else if (type == "broadcast") {
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
                    if (on) listeners[&ws] = target;
                    else listeners.erase(&ws);
                    // THIS session's ears, exactly as the Close handler counts them: the engine-wide total
                    // would leave the tap on a session nobody hears whenever another one still has a listener.
                    remaining = static_cast<size_t>(
                        std::count_if(listeners.begin(), listeners.end(),
                                      [&](const auto& kv) { return kv.second == target; }));
                    if (first) { std::lock_guard<std::mutex> a(arrivedMx); arrived.insert(target); }
                    host.post([target, &host, want = remaining > 0] { host.enableBroadcast(target, want); });
                }
                std::cerr << "[broadcast] " << (on ? "listener added to '" : "listener removed from '")
                          << target << "' (" << remaining << " listening to it)\n";
            } else if (type == "flush") {
                // Forget the project — plugins, edit, diff baseline — when the client switches projects; the engine stays up with its audio device and scan cache.
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
                    // One line per transport move tells "the engine never got play" from "it played and you heard nothing"; the 20 Hz state frame stays out of the log.
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
                    else if (action == "panic") host.panic(session);
                    else if (action == "seek") host.seek(session, position);
                    else if (action == "loop") host.setLoop(session, loopStart, loopEnd, loopOn);
                });
            } else if (type == "preview") {
                // Audition one sample over [start, start+length) seconds, length <= 0 being the whole file — independent of the transport, so it works while stopped.
                const std::string file = j.value("file", std::string{});
                const double start = j.value("start", 0.0);
                const double length = j.value("length", 0.0);
                if (! file.empty())
                    host.post([session, &host, file, start, length] {
                        std::cerr << "[preview] " << file << " [" << start << ", "
                                  << length << "]\n";
                        host.previewSample(session, file, start, length);
                    });
            } else if (type == "note-preview") {
                // Audition one note through a track's OWN chain — the piano roll's click. Transport-independent, like `preview`.
                const std::string track = j.value("track", std::string{});
                const int key = j.value("key", -1);
                const double vel = j.value("vel", 1.0);
                if (! track.empty() && key >= 0 && key <= 127)
                    host.post([session, &host, track, key, vel] {
                        host.previewNote(session, track, key, (float) vel);
                    });
            } else if (type == "arm") {
                // Arm or disarm a track, omitting "armed" to toggle; the reply says which way it went, so the caller reports it without racing the state frame.
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
            } else if (type == "recorder") {
                // The RECORDER node's two engine verbs, free-running and transport-independent:
                // `record` (omit "on" to toggle) and `clear`, which pops the last take. `save` is
                // NOT here — the engine's job ends at a wav on disk. See docs/recorder.md.
                const std::string node = j.value("node", std::string{});
                const std::string action = j.value("action", std::string{});
                std::optional<bool> on;
                if (j.contains("on") && j.at("on").is_boolean())
                    on = j.at("on").get<bool>();
                host.post([session, &host, &broadcastTo, node, action, on] {
                    if (node.empty()) return;
                    const auto r = (action == "clear")
                        ? host.clearLastTake(session, node)
                        : host.setRecorderRecording(session, node,
                                                    on.value_or(!host.recorderRecording(session, node)));
                    if (!r.ok) {
                        std::cerr << "[rec] refused: " << r.error << std::endl;
                        broadcastTo(session, json{{"type", "error"}, {"message", r.error}});
                    }
                    // No reply on success: the state frame carries the light, at 20 Hz.
                });
            } else if (type == "record-enable") {
                // This session's record enable — whether play() records its armed tracks; omitting "enabled" toggles, and the value is echoed at once so the button lights.
                const bool has = j.contains("enabled") && j.at("enabled").is_boolean();
                const std::optional<bool> want =
                    has ? std::optional<bool>(j.at("enabled").get<bool>()) : std::nullopt;
                host.post([session, &host, &broadcastTo, want] {
                    const bool on = want.value_or(!host.recordEnabled(session));
                    host.setRecordEnabled(session, on);
                    broadcastTo(session, json{{"type", "record-enabled"}, {"enabled", on}});
                });
            } else if (type == "list-plugins" || type == "rescan-plugins") {
                // list-plugins returns the cache, scanning once if cold; rescan-plugins always refreshes, detached because a scan spawns a child per plugin and blocks. "filter" narrows by format, "force" re-scans all.
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

                // Say when a scan starts and why: it is by far the slowest thing the engine does, so a cold cache turning a list into a minute of work otherwise looks like a hang.
                if (doScan) {
                    std::cerr << "[plugins] rescan requested" << (force ? " (force)" : "")
                              << " — scanning, this can take a while\n";
                    std::thread([reply, force] { reply(ensurePluginsScanned(force)); }).detach();
                } else {
                    auto cached = studio::loadPluginCache();
                    // Count the EXTERNALS, not the entries: built-ins are synthesised in code, so a truncated exts.json still yields ~212 and logs a reassuring "212 from cache" while every VST silently fails.
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
            } else if (type == "list-plugin-params") {
                // Every parameter of an installed plugin TYPE, by instantiating it and asking — nothing short of a live instance can list them, so it runs DETACHED like a scan and broadcasts its reply.
                const std::string fmt = j.value("format", std::string{});
                const std::string id = j.value("id", std::string{});
                if (fmt.empty() || id.empty()) {
                    ws.send(json{{"type", "error"},
                                 {"message", "list-plugin-params needs a format and an id"}}
                                .dump());
                } else {
                    std::thread([&broadcast, fmt, id] {
                        const auto found = studio::pluginParamsOf(fmt, id);
                        json arr = json::array();
                        for (const auto& p : found.value_or(std::vector<studio::PluginParamInfo>{})) {
                            json one{{"name", p.name}, {"min", p.min}, {"max", p.max}};
                            if (p.hasDefault) one["def"] = p.def;
                            if (!p.states.empty()) {
                                json states = json::array();
                                for (const auto& [label, value] : p.states)
                                    states.push_back({{"label", label}, {"value", value}});
                                one["states"] = states;
                            }
                            arr.push_back(one);
                        }
                        std::cerr << "[plugin-param-list] " << id << ": "
                                  << (found ? std::to_string(arr.size()) + " parameters"
                                            : std::string{"could not be loaded"})
                                  << "\n";
                        // `plugin-param-LIST`, since `plugin-params` already carries a loaded INSTANCE's values, and `found` carries what an empty array cannot: could not load, versus loaded and publishes nothing.
                        broadcast(json{{"type", "plugin-param-list"},
                                       {"format", fmt},
                                       {"id", id},
                                       {"found", found.has_value()},
                                       {"params", arr}});
                    }).detach();
                }
            } else if (type == "list-edit-plugins") {
                // Every session's plugin instances for the tray's submenu, each row naming its session — ENGINE-GLOBAL, since the asker drives none (docs/sessions.md); message thread, and broadcast.
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
            } else if (type == "drop-session") {
                // Forget a session outright — the tray's way of clearing one an app left behind, addressed by `session` like every other message rather than by an `id` field.
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
            } else if (type == "show-native-plugin-ui-of") {
                // …and the same window for a plugin in NO project, on an ORPHAN instance saved nowhere: the seconds-long load runs detached, and only the window itself needs the message thread.
                const std::string fmt = j.value("format", std::string{});
                const std::string id = j.value("id", std::string{});
                if (fmt.empty() || id.empty()) {
                    ws.send(json{{"type", "error"},
                                 {"message", "show-native-plugin-ui-of needs a format and an id"}}
                                .dump());
                } else {
                    std::thread([&host, &broadcast, fmt, id] {
                        std::cerr << "[native-plugin-ui] loading '" << id << "'" << "\n";
                        // ANSWERED either way, not out of politeness: a load can hang outright, and a caller told nothing cannot tell a slow load from a dead one.
                        if (!studio::prepareNativePluginUI(fmt, id)) {
                            std::cerr << "[native-plugin-ui] '" << id << "' did not load" << "\n";
                            broadcast(json{{"type", "native-plugin-ui-opened"},
                                           {"format", fmt},
                                           {"id", id},
                                           {"ok", false}});
                            return;   // prepareNativePluginUI has already warned, which reaches a human
                        }
                        host.post([&broadcast, fmt, id] {
                            const bool ok = studio::showNativePluginUIOf(fmt, id);
                            std::cerr << "[native-plugin-ui] " << (ok ? "open '" : "could not open '")
                                      << id << "'" << "\n";
                            broadcast(json{{"type", "native-plugin-ui-opened"},
                                           {"format", fmt},
                                           {"id", id},
                                           {"ok", ok}});
                        });
                    }).detach();
                }
            } else if (type == "snapshot-plugin-base") {
                // Keep what the orphan window holds, as a .vstpreset at an absolute `path` the file service chose — MESSAGE THREAD, since the instance exists already and its state is read where its editor lives.
                const std::string fmt = j.value("format", std::string{});
                const std::string id = j.value("id", std::string{});
                const std::string path = j.value("path", std::string{});
                if (fmt.empty() || id.empty() || path.empty()) {
                    ws.send(json{{"type", "error"},
                                 {"message", "snapshot-plugin-base needs a format, an id and a path"}}
                                .dump());
                } else {
                    host.post([&broadcast, fmt, id, path] {
                        const bool ok = studio::snapshotOrphanPluginTo(fmt, id, path);
                        std::cerr << "[plugin-base] " << (ok ? "wrote " : "could not write ")
                                  << path << "\n";
                        // Answered rather than left for the caller to look: no instance open and a plugin with no state both leave no file at all.
                        broadcast(json{{"type", "plugin-base-saved"},
                                       {"format", fmt},
                                       {"id", id},
                                       {"path", path},
                                       {"ok", ok}});
                    });
                }
            } else if (type == "set-plugin-param") {
                // Set one plugin parameter on the LIVE edit for a control being dragged; it does NOT persist — the client writes on release — and it is unlogged, arriving at interactive rates.
                const std::string id = j.value("id", std::string{});
                const std::string name = j.value("name", std::string{});
                const double value = j.value("value", 0.0);
                host.post([session, &host, id, name, value] { host.setPluginParam(session, id, name, value); });
            } else if (type == "get-plugin-params") {
                // Every automatable parameter of a live plugin with its CURRENT value — EVERY one, unlike the editor-close broadcast's minimal preset, since a control drawn at its minimum for want of a saved value is simply wrong; `meta` rides alongside as a SEPARATE object.
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
                // The presets a MODULE's external plugin offers — programs plus .vstpreset files — for the editor's dropdown; `module` is a name the engine resolves to a live instance.
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
                // Load a preset into every live instance of `module` and persist it to the module's .vstpreset — `path` picks a file, else `index` a program — broadcasting preset-saved.
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
                // Subscribe a plugin to the live parameter stream — how a knob turned in its own window reaches this client; the watch set is the ENGINE's, so a second watcher is a no-op and the last unwatch stops it for everyone.
                const std::string id = j.value("id", std::string{});
                const bool on = j.value("on", true);
                if (!id.empty())
                    host.post([session, &host, id, on] { host.watchPluginParams(session, id, on); });
            } else if (type == "subscribe-waveform" || type == "unsubscribe-waveform") {
                // Subscribe a module's waveform tap by PluginDoc `id` and `side` — deliberately no `trackIndex`, since the graph has none and a client sending 0 would meter the FIRST track instead; no waveform beats a confidently wrong one.
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
            } else if (type == "audio-cost") {
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
            } else if (type == "list-audio-devices") {
                // Enumerate audio interfaces (message thread — touches JUCE devices).
                host.post([session, &host, &broadcast] { broadcast(audioDevicesMsg(host)); });
            } else if (type == "io-levels") {
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
            } else if (type == "set-input-stereo") {
                // Group two interface inputs into one stereo device or split them, `channel` being 1-based and naming its PAIR — nothing is broadcast back, since the layout rides on `io-levels`, which the rebuild is forced through before returning.
                const int channel = j.value("channel", 0);
                const bool stereo = j.value("stereo", false);
                host.post([session, &host, &broadcastTo, channel, stereo] {
                    if (!host.setInputStereo(channel, stereo))
                        broadcastTo(session, json{{"type", "error"},
                                                  {"message", "no audio interface open to group inputs on"}});
                });
            } else if (type == "set-audio-device") {
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
            } else if (type == "whoami" || type == "hello") {
                // Identity probe, replied to the ASKING socket alone and answered OFF the message thread, which is safe only because audioTiming() reads two atomics (docs/protocol.md).
                const auto timing = host.audioTiming();
                ws.send(json{{"type", "whoami"},
                             {"id", engineId},
                             {"token", engineToken},
                             {"bufferSize", timing.bufferFrames},
                             {"sampleRate", timing.sampleRate}}
                            .dump());

                // …and, if this socket says it DRIVES a session, start counting it — on hello, so a reconnect restores the count, and ONCE per socket, since the keepalive re-sends whoami (docs/sessions.md).
                if (j.value("role", std::string{}) == "driver") {
                    bool isNew;
                    {
                        std::lock_guard<std::mutex> lk(listenersMx);
                        isNew = drivers.emplace(&ws, session).second;
                    }
                    if (isNew) host.post([&host, session] { host.addDriver(session); });
                }
            } else {
                // A message we don't understand is version skew between brain and engine — logged here too, or the only trace is an error the client may be ignoring.
                std::cerr << "[client] unknown message type: '" << type << "'\n";
                ws.send(json{{"type", "error"}, {"message", "unknown message type: " + type}}.dump());
            }
        };

    // The ONE catch on this socket, and it is load-bearing: IXWebSocket has none of its own, so an
    // exception escaping the handler reaches std::terminate and takes every session with it. `value()`
    // throws on a field of the wrong TYPE and on a message that is not an object at all. docs/protocol.md.
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
    host.onState([&server, &listenersMx, &subscribers](const studio::EngineHost::EngineState& s) {
        json wf = json::object();
        for (const auto& [key, envelopes] : s.waveformEnvelopes) {
            json arr = json::array();
            for (const auto& e : envelopes)
                arr.push_back({{"min", e.min}, {"max", e.max}});
            wf[key] = std::move(arr);
        }
        json recs = json::object();
        for (const auto& [key, r] : s.recorders) {
            json takes = json::array();
            for (const auto& t : r.takes)
                takes.push_back({{"file", t.file}, {"seconds", t.seconds}, {"damaged", t.damaged}});
            json env = json::array();
            for (const auto& e : r.envelope)
                env.push_back({{"min", e.min}, {"max", e.max}});
            recs[key] = json{{"recording", r.recording},
                             {"seconds", r.seconds},
                             {"takes", std::move(takes)},
                             {"envelope", std::move(env)},
                             // Where those points START in the take, so a client can tell an
                             // append from a resend it has already drawn (docs/recorder.md).
                             {"from", r.envelopeFrom}};
        }
        const auto payload = json{
            {"type", "state"},
            // WHICH project this frame describes; empty is the default session, what a client that never asked for one drives.
            {"session", s.session},
            {"playing", s.playing},
            {"playhead", s.playheadSeconds},
            {"levels", s.trackLevelsDb},
            {"inputLevels", s.trackInputLevelsDb},
            {"armed", s.armedTracks},
            {"recordEnabled", s.recordEnabled},
            // The master output and whether it overloaded since the last frame — the same number `io-levels` carries, read through a second client (docs/meterClients.md).
            {"master", s.masterLevelDb},
            {"masterClipped", s.masterOverload},
            {"waveform", std::move(wf)},
            // Each platter's own needle, in seconds of its record — absent for a deck playing a clip.
            {"platters", s.platterSeconds},
            // …and each RECORDER node: whether it is rolling, and the take's picture SINCE THE LAST
            // FRAME, which the client appends rather than replaces (docs/recorder.md).
            {"recorders", std::move(recs)},
        }.dump();

        // Chosen under the lock, sent outside it: a server-side send blocks until the peer's window drains, so holding the lock would park every connection thread; the shared_ptrs keep the sockets alive.
        std::vector<std::shared_ptr<ix::WebSocket>> targets;
        {
            const auto clients = server.getClients();
            std::lock_guard<std::mutex> lk(listenersMx);
            for (auto& client : clients)
                if (auto hit = subscribers.find(client.get());
                    hit != subscribers.end() && hit->second == s.session)
                    targets.push_back(client);
        }
        for (auto& client : targets) client->send(payload);
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

    // When a plugin's editor closes the engine persists its state to the module — text params where they capture it, else a .vstpreset — and notifies clients, whose watcher reloads.
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
    // Engine warnings reach the CLIENT and not just stderr: the tray adopts an engine it did not spawn, so its output goes nowhere a user can see.

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
        std::cerr << "st0-engine: listen failed: " << res.second << "\n";
        return 1;
    }
    server.start();

    // The audio broadcast: drain the master tap and push it as BINARY to whoever asked, on ITS OWN THREAD because a server-side sendBinary blocks unboundedly (docs/broadcast.md).
    std::atomic<bool> senderRunning{true};
    std::thread senderThread([&host, &server, &listenersMx, &listeners, &sinceBoot,
                              &senderRunning] {
        // Per SESSION, not per engine: one latch would have the second project's unprepared tap withhold frames in silence.
        std::set<std::string> warnedNoRate;

        // Drain ONE session's ring and send it to ONE session's listeners — a lambda, because the pass below loops over sessions.
        const auto pump =
            [&](const std::string& sid,
                const std::vector<std::shared_ptr<ix::WebSocket>>& targets) {
                // Drain everything waiting, not one frame per pass: a ceiling equal to the production rate has NO headroom, so any late wake-up leaves a backlog that fills the ring within a second.
                for (int guard = 0; guard < kBroadcastFramesPerPass; ++guard) {
                    auto chunk = host.drainBroadcast(sid, kBroadcastMaxFrames);
                    if (chunk.frames == 0) break;

                    // A rate of 0 means this session's tap has never been through initialise(), and stream.ts rejects it, so it would vanish in silence.
                    if (chunk.sampleRate < 8000.0) {
                        if (warnedNoRate.insert(sid).second)
                            std::cerr << "[broadcast] the tap on '" << sid << "' has no sample rate "
                                         "yet — frames withheld until the graph has prepared it\n";
                        break;
                    }

                    // A hole the tap overwrote becomes a JUMP in the sequence number, so the listener re-cushions; rounded UP, since integer division would report a sub-frame hole as none.
                    const uint32_t seq =
                        nextSeq(sid, 1 + static_cast<uint32_t>(
                                              (chunk.lostFrames + kBroadcastMaxFrames - 1) /
                                              kBroadcastMaxFrames));
                    const auto payload = encodeStreamFrame(chunk, seq, sinceBoot());

                    // Sent OUTSIDE the listener lock, since this send blocks and holding the lock would stall every connection thread reaching the Close handler.
                    for (auto& client : targets) {
                        if (client->bufferedAmount() > kBroadcastMaxQueuedBytes) continue;
                        client->sendBinary(payload);
                    }
                    if (chunk.frames < kBroadcastMaxFrames) break;   // ring is empty
                }
            };

        while (senderRunning.load(std::memory_order_relaxed)) {
            // A session whose first listener just arrived starts from LIVE, honoured here because moving a read cursor belongs to this thread alone.
            {
                std::set<std::string> justArrived;
                {
                    std::lock_guard<std::mutex> a(arrivedMx);
                    justArrived.swap(arrived);
                }
                for (const auto& sid : justArrived) host.skipBroadcastToLive(sid);
            }

            // WHO IS LISTENING TO WHAT, the whole point of this pass: a session's audio goes only to the sockets driving that session, never the one global master.
            std::map<std::string, std::vector<std::shared_ptr<ix::WebSocket>>> bySession;
            {
                const auto clients = server.getClients();
                std::lock_guard<std::mutex> lk(listenersMx);
                // Prune the departed FIRST: keyed by raw pointer, an entry left by a Close that never arrived could match a later socket at the same address and hand a tray probe 3 Mbit/s.
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

            // Retire the counters of sessions the ENGINE has forgotten — never merely of ones with no listener
            // right now: a sequence that restarted under a listener who came back would read as a 4-billion-frame
            // hole (`seqGap` is unsigned). Only when there is something stale to find, this asking for a lock.
            if (broadcastSeq.size() > bySession.size()) {
                std::set<std::string> live;
                for (const auto& sid : host.sessionIds()) live.insert(sid);
                forgetSeqsExcept(live);
                for (auto it = warnedNoRate.begin(); it != warnedNoRate.end();)
                    it = live.count(*it) ? std::next(it) : warnedNoRate.erase(it);
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(kBroadcastTickMs));
        }
    });

    std::cerr << "st0-engine listening on ws://" << bindHost << ":" << port
              << (engineId.empty() ? std::string{}
                                   : " (id " + engineId + ")")
              << "\n";
    std::cerr << "[startup] port bound at " << sinceBoot()
              << "ms (audio device opens on the message loop; its timing is logged "
                 "when it completes)\n";

    // Warm the plugin cache in the background at startup so the first list-plugins never waits on a cold sweep — a no-op when warm, and serialized with the on-demand path.
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

    // server.stop() FIRST, then join: the sender can be parked in a send with no timeout, and closing the socket is the only thing that unwedges it.
    senderRunning.store(false, std::memory_order_relaxed);
    server.stop();
    senderThread.join();

    ix::uninitNetSystem();
    return 0;
}
