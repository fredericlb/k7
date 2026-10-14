// k7-runtime — the executable: the CLI's one-shot modes (scan, render, freeze, dumps, waveforms), and
// otherwise the server, which lives in Serve.cpp so the Android library can run it without a main().
// This file includes NO JUCE/Tracktion headers. The modes are in docs/cliModes.md.

#include "DocJson.h"
#include "Serve.h"

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
        out = studio::docFromJson(j.contains("doc") ? j.at("doc") : j);
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
                      << "        Delete the objects for engine/*.cpp and rebuild — engine/k7-runtime/AGENTS.md.\n";
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
    // Surge XT's parameters and what each oscillator and effect type names its slots: what scripts/gen-surge-panel.mjs reads.
    if (argc >= 2 && std::string(argv[1]) == "--dump-surge-layout")
        return studio::dumpSurgeLayout();

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
                docs.push_back(studio::docFromJson(json::parse(ss.str())));
                baseDirs.push_back("");
            } catch (const std::exception& e) {
                std::cerr << "bad doc " << a << ": " << e.what() << "\n";
                return 2;
            }
        }
        if (docs.size() < 2) {
            std::cerr << "usage: k7-runtime --multi-edit-test <doc1.json> <doc2.json> [--seconds N]\n";
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
            std::cerr << "usage: k7-runtime --render <doc.json|-> --out <dir> "
                         "[--stems] [--base <dir>]\n";
            return 2;
        }
        studio::ProjectDoc doc;
        if (!readDocArg(input, doc)) return 2;
        return studio::renderOffline(doc, baseDir, outDir, stems);
    }

    // Decode mode: the file's frames on stdout for @studio/audio-analysis, which builds the waveform sidecar and measures a true peak from them.
    if (argc >= 3 && std::string(argv[1]) == "--decode") return studio::decodeToStdout(argv[2]);

    // No `--normalize` mode: normalising is a treatment, and a treatment is a chain the brain bounces material through with `--render` (packages/commands/docs/processChain.md).

    return studio::serve(argc > 1 ? std::atoi(argv[1]) : 8765);
}
