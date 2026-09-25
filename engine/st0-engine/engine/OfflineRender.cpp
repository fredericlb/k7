// Offline render (bounce to wav) — see the renderOffline declaration in EngineHost.h.
// Device-free (mirrors dumpPluginParams): builds a bare Engine + Edit, no audio
// device, no playback context — te::Renderer pulls the graph directly. This is why
// MIDI-through-instrument tracks (which the ffmpeg render can't touch) come out here:
// populateEdit realises the 4OSC synth on the track.

#include "EngineHost.h"

#include "EngineTypes.h"     // Tracktion/JUCE + the te/tt/fs aliases
#include "PluginScan.h"      // registerBuiltInPlugins
#include "EditBuilder.h"     // populateEdit
#include "MessagePump.h"     // pumpMessages — the render loop's dispatch

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>

#if JUCE_WINDOWS
 #include <windows.h>
 #include <dbghelp.h>
#endif

namespace studio {

namespace {

// Progress trace, off unless STUDIO_RENDER_TRACE is set: a stalled bounce otherwise prints NOTHING, which is indistinguishable from slow.
void trace(const char* what) {
    static const bool on = std::getenv("STUDIO_RENDER_TRACE") != nullptr;
    if (on) std::cerr << "[render:trace] " << what << std::endl;
}

#if JUCE_WINDOWS
// Watchdog: print THIS thread's symbolised stack if it is still here in `seconds`, gated on STUDIO_RENDER_TRACE — "Debugging a hang with no debugger" in AGENTS.md.
void watchdogStack(int seconds) {
    if (std::getenv("STUDIO_RENDER_TRACE") == nullptr) return;
    HANDLE stuck = nullptr;
    DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &stuck,
                    0, FALSE, DUPLICATE_SAME_ACCESS);
    std::thread([stuck, seconds] {
        std::this_thread::sleep_for(std::chrono::seconds(seconds));
        auto proc = GetCurrentProcess();
        SymSetOptions(SYMOPT_DEFERRED_LOADS | SYMOPT_UNDNAME);
        SymInitialize(proc, nullptr, TRUE);
        SuspendThread(stuck);
        CONTEXT ctx{};
        ctx.ContextFlags = CONTEXT_FULL;
        if (GetThreadContext(stuck, &ctx)) {
            STACKFRAME64 f{};
            f.AddrPC.Offset = ctx.Rip;       f.AddrPC.Mode = AddrModeFlat;
            f.AddrFrame.Offset = ctx.Rbp;    f.AddrFrame.Mode = AddrModeFlat;
            f.AddrStack.Offset = ctx.Rsp;    f.AddrStack.Mode = AddrModeFlat;
            std::cerr << "[render:stack] stuck thread:\n";
            for (int i = 0; i < 50; ++i) {
                if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, proc, stuck, &f, &ctx, nullptr,
                                 SymFunctionTableAccess64, SymGetModuleBase64, nullptr) || f.AddrPC.Offset == 0)
                    break;
                char buf[sizeof(SYMBOL_INFO) + 512]{};
                auto* sym = reinterpret_cast<SYMBOL_INFO*>(buf);
                sym->SizeOfStruct = sizeof(SYMBOL_INFO);
                sym->MaxNameLen = 500;
                DWORD64 disp = 0;
                std::cerr << "  #" << i << " ";
                if (SymFromAddr(proc, f.AddrPC.Offset, &disp, sym)) std::cerr << sym->Name << "\n";
                else std::cerr << std::hex << f.AddrPC.Offset << std::dec << "\n";
            }
            std::cerr.flush();
        }
        ResumeThread(stuck);
        std::_Exit(3);
    }).detach();
}
#else
void watchdogStack(int) {}
#endif

}  // namespace

#if JUCE_WINDOWS
namespace {
// Walk and symbolise the faulting thread's stack from inside the exception filter: the context the OS hands us IS the faulting one, so there is no thread to suspend.
LONG WINAPI crashFilter(EXCEPTION_POINTERS* info) {
    auto proc = GetCurrentProcess();
    SymSetOptions(SYMOPT_DEFERRED_LOADS | SYMOPT_UNDNAME);
    SymInitialize(proc, nullptr, TRUE);
    std::cerr << "\n[crash] exception 0x" << std::hex
              << info->ExceptionRecord->ExceptionCode << std::dec << " — stack:\n";
    CONTEXT ctx = *info->ContextRecord;
    STACKFRAME64 f{};
    f.AddrPC.Offset = ctx.Rip;       f.AddrPC.Mode = AddrModeFlat;
    f.AddrFrame.Offset = ctx.Rbp;    f.AddrFrame.Mode = AddrModeFlat;
    f.AddrStack.Offset = ctx.Rsp;    f.AddrStack.Mode = AddrModeFlat;
    for (int i = 0; i < 60; ++i) {
        if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, proc, GetCurrentThread(), &f, &ctx, nullptr,
                         SymFunctionTableAccess64, SymGetModuleBase64, nullptr) || f.AddrPC.Offset == 0)
            break;
        char buf[sizeof(SYMBOL_INFO) + 512]{};
        auto* sym = reinterpret_cast<SYMBOL_INFO*>(buf);
        sym->SizeOfStruct = sizeof(SYMBOL_INFO);
        sym->MaxNameLen = 500;
        DWORD64 disp = 0;
        std::cerr << "  #" << i << " ";
        if (SymFromAddr(proc, f.AddrPC.Offset, &disp, sym)) std::cerr << sym->Name;
        else std::cerr << std::hex << f.AddrPC.Offset << std::dec;
        IMAGEHLP_LINE64 lineInfo{};
        lineInfo.SizeOfStruct = sizeof(lineInfo);
        DWORD lineDisp = 0;
        if (SymGetLineFromAddr64(proc, f.AddrPC.Offset, &lineDisp, &lineInfo))
            std::cerr << "  (" << lineInfo.FileName << ":" << lineInfo.LineNumber << ")";
        std::cerr << "\n";
    }
    std::cerr.flush();
    return EXCEPTION_CONTINUE_SEARCH;
}
}  // namespace

void installCrashHandler() { SetUnhandledExceptionFilter(crashFilter); }
#else
void installCrashHandler() {}
#endif

namespace {

// Filesystem-safe stem filename from a track name.
std::string sanitizeStem(const std::string& name, int index) {
    std::string out;
    for (char c : name) {
        const unsigned char u = static_cast<unsigned char>(c);
        out += (std::isalnum(u) || c == '-' || c == '_' || c == ' ') ? c : '_';
    }
    size_t b = out.find_first_not_of(' ');
    size_t e = out.find_last_not_of(' ');
    out = (b == std::string::npos) ? "" : out.substr(b, e - b + 1);
    if (out.empty()) out = "track" + std::to_string(index + 1);
    return out;
}

std::string jsonString(const std::string& s) {
    return juce::JSON::toString(juce::var(juce::String(s))).toStdString();
}

// The `tracksToDo` bitset for a set of tracks — NOT te::toBitSet(), which is broken upstream and sets every bit whatever you pass it (docs/cliModes.md).
juce::BigInteger trackBits(te::Edit& edit, const juce::Array<te::Track*>& wanted) {
    juce::BigInteger bits;
    auto all = te::getAllTracks(edit);
    for (auto* t : wanted)
        if (const int i = all.indexOf(t); i >= 0)
            bits.setBit(i);
    return bits;
}

// Every track a MIXDOWN is made of: `tracksToDo` never consults output routing — docs/cueOutput.md.
juce::Array<te::Track*> tracksOnTheMix(te::Edit& edit, const ProjectDoc& doc) {
    // By INDEX, the correspondence populateEdit uses: only a bus happens to be named after its id.
    auto audio = te::getAudioTracks(edit);
    std::set<te::Track*> offTheMix;
    for (size_t i = 0; i < doc.tracks.size() && i < static_cast<size_t>(audio.size()); ++i)
        if (!doc.tracks[i].outputChannels.empty())
            offTheMix.insert(audio[static_cast<int>(i)]);
    juce::Array<te::Track*> keep;
    for (auto* t : te::getAllTracks(edit))
        if (t != nullptr && offTheMix.count(t) == 0) keep.add(t);
    return keep;
}

// How long a render may make no progress before it is called stuck, rather than slow.
constexpr int kStallTimeoutSeconds = 90;

// Bounce a set of the edit's tracks to `out`, pumping runJob() by hand: the blocking renderToFile overloads route through UIBehaviour, a no-op headless.
bool renderTracks(te::Edit& edit, const juce::File& out, const juce::BigInteger& bits, bool useMaster,
                  const tt::TimeRange& range, double sr) {
    if (bits.countNumberOfSetBits() == 0) return false;
    te::Renderer::Parameters params(edit);
    params.destFile = out;
    params.audioFormat = edit.engine.getAudioFileFormatManager().getWavFormat();
    params.bitDepth = 24;
    params.blockSizeForAudio = 512;
    params.sampleRateForAudio = sr;
    params.time = range;
    params.tracksToDo = bits;
    params.usePlugins = true;
    params.useMasterPlugins = useMaster;
    std::atomic<float> progress{0.0f};
    trace("createRenderTask");
    auto task = te::render_utils::createRenderTask(params, "st0 export", &progress, nullptr);
    if (!task) return false;
    trace("runJob loop");
    // Dispatch between blocks: a non-wav source plays off a PROXY whose render is kicked off by a juce Timer, so a loop that never pumps waits forever on a file nobody writes (docs/cliModes.md).
    auto lastProgress = progress.load();
    auto lastMoved = std::chrono::steady_clock::now();
    while (task->runJob() == juce::ThreadPoolJob::jobNeedsRunningAgain) {
        pumpMessages(0);
        const auto now = std::chrono::steady_clock::now();
        if (progress.load() > lastProgress) { lastProgress = progress.load(); lastMoved = now; }
        // A source the engine cannot decode leaves its node forever un-ready; fail loudly rather than spin, since a render that never returns reads as a wedged machine.
        else if (now - lastMoved > std::chrono::seconds(kStallTimeoutSeconds)) {
            std::cerr << "[render] stalled for " << kStallTimeoutSeconds
                      << "s with no progress — a clip's source is probably undecodable\n";
            return false;
        }
    }
    trace("runJob done");
    return out.existsAsFile() && out.getSize() > 0;
}

// The edit an offline bounce runs on — device-free, built-ins registered, populated from the doc — shared by the export and the freeze.
std::unique_ptr<te::Edit> buildRenderEdit(te::Engine& engine, const ProjectDoc& doc, const std::string& baseDir) {
    trace("registerBuiltInPlugins");
    registerBuiltInPlugins(engine);
    trace("createSingleTrackEdit");
    auto edit = te::Edit::createSingleTrackEdit(engine);
    trace("populateEdit");
    populateEdit(engine, *edit, doc, baseDir);
    trace("populateEdit done");
    // One pump, or SamplerPlugin never builds its sounds and a rack track renders silent — and the watchdog guards THIS line, since pumping runs the MIDI timer too (AGENTS.md).
    watchdogStack(20);
    pumpMessages(200);
    trace("pump done");
    return edit;
}

// Let the message thread finish what the render left queued before the Edit is destroyed — "A CLI must drain the message queue before it returns" in AGENTS.md.
void drainMessageQueue(int ms = 200) {
    if (juce::MessageManager::getInstanceWithoutCreating() != nullptr)
        pumpMessages(ms);
}

// Everything the edit plays, plus a 2s tail for synth release and reverb.
tt::TimeRange fullRange(te::Edit& edit) {
    return tt::TimeRange(tt::TimePosition(), edit.getLength() + tt::TimeDuration::fromSeconds(2.0));
}

double renderRate(const ProjectDoc& doc) {
    return doc.sampleRate > 0 ? static_cast<double>(doc.sampleRate) : 48000.0;
}


}  // namespace

// A headless engine: everything Tracktion needs to BUILD and render an edit, and no audio device — "The audio device is opened ONCE, explicitly" in AGENTS.md.
struct HeadlessBehaviour : te::EngineBehaviour {
    bool autoInitialiseDeviceManager() override { return false; }
};

// The engine both offline paths use. Constructed the same way in both, because they fail the same way.
std::unique_ptr<te::Engine> makeOfflineEngine() {
    auto engine = std::make_unique<te::Engine>("Studio", nullptr,
                                               std::make_unique<HeadlessBehaviour>());

    // The hosted-device route for ONE side effect — no MIDI rescan, whose RPC into midisrv.exe never returns when that service is wedged — and BEFORE anything pumps (AGENTS.md).
    te::HostedAudioDeviceInterface::Parameters p;
    p.useMidiDevices = false;
    engine->getDeviceManager().getHostedAudioDeviceInterface().initialise(p);
    return engine;
}


// Render the doc to <outDir>/mix.wav and, with `stems`, one wav per track, printing a JSON manifest; non-zero when nothing was audible.
int renderOffline(const ProjectDoc& doc, const std::string& baseDir,
                  const std::string& outDir, bool stems) {
    trace("juce init");
    juce::ScopedJuceInitialiser_GUI juceInit;
    trace("engine ctor");
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    trace("engine ready");
    auto edit = buildRenderEdit(engine, doc, baseDir);
    trace("edit ready");

    std::error_code ec;
    fs::create_directories(outDir, ec);

    const double sr = renderRate(doc);
    const auto range = fullRange(*edit);
    const juce::File dir{juce::String(outDir)};

    auto renderOne = [&](const juce::File& out, const juce::BigInteger& bits, bool useMaster) -> bool {
        return renderTracks(*edit, out, bits, useMaster, range, sr);
    };

    if (!renderOne(dir.getChildFile("mix.wav"), trackBits(*edit, tracksOnTheMix(*edit, doc)), true)) {
        std::cerr << "[render] mixdown produced no audio (song has nothing audible)\n";
        return 1;
    }

    std::ostringstream manifest;
    manifest << "{\"mix\":\"mix.wav\",\"stems\":[";
    if (stems) {
        auto tracks = te::getAudioTracks(*edit);
        bool first = true;
        for (int i = 0; i < tracks.size(); ++i) {
            juce::Array<te::Track*> one;
            one.add(tracks[i]);
            const std::string tname = tracks[i]->getName().toStdString();
            const std::string fname = sanitizeStem(tname, i) + ".wav";
            if (!renderOne(dir.getChildFile(juce::String(fname)), trackBits(*edit, one), false)) {
                std::cerr << "[render] stem '" << tname << "' had no audio — skipped\n";
                continue;
            }
            manifest << (first ? "" : ",") << "{\"name\":" << jsonString(tname)
                     << ",\"file\":" << jsonString(fname) << "}";
            first = false;
        }
    }
    manifest << "]}";
    std::cout << manifest.str() << std::endl;
    edit.reset();
    drainMessageQueue();
    return 0;
}

// Bounce ONE track to `outFile` — the export's stem path with another destination, and what the caller must neutralise first: docs/cliModes.md.
int freezeTrack(const ProjectDoc& doc, const std::string& baseDir, const std::string& trackId,
                const std::string& outFile) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    auto edit = buildRenderEdit(engine, doc, baseDir);

    // By the doc ID through the same index map the live engine uses; the NAME is only a fallback, and matching on it alone was the bug — docs/cliModes.md.
    te::Track* found = trackById(*edit, trackId, doc);
    if (found == nullptr)
        for (auto* t : te::getAudioTracks(*edit))
            if (t->getName().toStdString() == trackId) {
                found = t;
                break;
            }
    if (found == nullptr) {
        std::cerr << "[freeze] no track '" << trackId << "' in the project\n";
        return 1;
    }

    const juce::File out{juce::String(outFile)};
    std::error_code ec;
    fs::create_directories(out.getParentDirectory().getFullPathName().toStdString(), ec);

    juce::Array<te::Track*> one;
    one.add(found);
    if (!renderTracks(*edit, out, trackBits(*edit, one), false, fullRange(*edit), renderRate(doc))) {
        // A silent track is a real answer to "freeze this" and not one worth writing: zeroes would then play in place of a track the user can still fix.
        std::cerr << "[freeze] track '" << trackId << "' produced no audio - nothing to freeze\n";
        return 1;
    }
    std::cout << jsonString(out.getFullPathName().toStdString()) << std::endl;
    // Before `edit` and `engine` unwind — see drainMessageQueue.
    edit.reset();
    drainMessageQueue();
    return 0;
}

}  // namespace studio
