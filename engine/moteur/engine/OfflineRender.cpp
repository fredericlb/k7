// Offline render (bounce to wav) — see the renderOffline declaration in EngineHost.h.
// Device-free (mirrors dumpPluginParams): builds a bare Engine + Edit, no audio
// device, no playback context — te::Renderer pulls the graph directly. This is why
// MIDI-through-instrument tracks (which the ffmpeg render can't touch) come out here:
// populateEdit realises the 4OSC synth on the track.

#include "EngineHost.h"

#include "EngineTypes.h"     // Tracktion/JUCE + the te/tt/fs aliases
#include "PluginScan.h"      // registerBuiltInPlugins
#include "EditBuilder.h"     // populateEdit

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
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

// Progress trace, off unless STUDIO_RENDER_TRACE is set. An offline bounce that stalls prints NOTHING otherwise
// — no output at all is indistinguishable from slow, which is exactly the shape that cost a night here.
void trace(const char* what) {
    static const bool on = std::getenv("STUDIO_RENDER_TRACE") != nullptr;
    if (on) std::cerr << "[render:trace] " << what << std::endl;
}

#if JUCE_WINDOWS
// Watchdog: print THIS thread's stack if it is still here in `seconds`. A render that stalls prints nothing and
// burns no CPU, which is indistinguishable from slow — and there is no debugger on the build machines.
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
// Walk and symbolise the faulting thread's stack, from inside the exception filter — the context
// the OS hands us IS the faulting one, so there is no thread to suspend.
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

// The `tracksToDo` bitset for a set of tracks: bit i set for each track's index in getAllTracks(edit).
//
// NOT te::toBitSet(), which is what this replaces. That one is broken upstream — it iterates the EDIT's tracks
// instead of the argument it was given:
//
//     for (auto t : allTracks)
//         if (int index = allTracks.indexOf (t); index >= 0)
//             bitset.setBit (index);
//
// so it sets every bit whatever you pass in, and any render asking for a subset silently got the whole mix. That
// is what made two different frozen tracks come out bit-identical, and it had the stem export producing one copy
// of the mixdown per track for as long as that feature has existed.
juce::BigInteger trackBits(te::Edit& edit, const juce::Array<te::Track*>& wanted) {
    juce::BigInteger bits;
    auto all = te::getAllTracks(edit);
    for (auto* t : wanted)
        if (const int i = all.indexOf(t); i >= 0)
            bits.setBit(i);
    return bits;
}

// Bounce a set of the edit's tracks to `out`. The blocking renderToFile overloads route through
// UIBehaviour::runTaskWithProgressBar, a no-op headless — so we build the render task and pump runJob() here.
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
    while (task->runJob() == juce::ThreadPoolJob::jobNeedsRunningAgain) {}
    trace("runJob done");
    return out.existsAsFile() && out.getSize() > 0;
}

// The edit an offline bounce runs on: device-free, built-ins registered, populated from the doc. Shared by the
// export and the freeze, which differ only in what they then render.
std::unique_ptr<te::Edit> buildRenderEdit(te::Engine& engine, const ProjectDoc& doc, const std::string& baseDir) {
    trace("registerBuiltInPlugins");
    registerBuiltInPlugins(engine);
    trace("createSingleTrackEdit");
    auto edit = te::Edit::createSingleTrackEdit(engine);
    trace("populateEdit");
    populateEdit(engine, *edit, doc, baseDir);
    trace("populateEdit done");
    // SamplerPlugin builds its playable sounds on an async message-thread callback triggered by populateEdit, and
    // this headless render otherwise never pumps the loop — without one flush a rack track renders silent. The live
    // engine already pumps its message thread and needs no equivalent.
    //
    // The watchdog guards THIS line specifically: pumping also runs Tracktion's timers, and one of them enumerates
    // hardware MIDI, which can block forever on a wedged midisrv (see AGENTS.md). makeOfflineEngine turns that scan
    // off; the watchdog is what names the next thing to hang here, instead of leaving a silent process.
    watchdogStack(20);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(200);
    trace("pump done");
    return edit;
}

// Let the message thread finish what the render left queued before the Edit is destroyed.
//
// An offline bounce never pumps the loop (there is no app), so every asyncUpdate an external plugin posted while
// it was being torn down is still sitting there when the Edit goes. That crashed roughly half of all freezes —
// after the wav was fully written and the path printed, which is the worst shape for a bug to have: the file was
// perfect and the caller saw a non-zero exit. Pumping here gives those callbacks a thread to run on while their
// objects are still alive.
void drainMessageQueue(int ms = 200) {
    if (auto* mm = juce::MessageManager::getInstanceWithoutCreating())
        mm->runDispatchLoopUntil(ms);
}

// Everything the edit plays, plus a 2s tail for synth release and reverb.
tt::TimeRange fullRange(te::Edit& edit) {
    return tt::TimeRange(tt::TimePosition(), edit.getLength() + tt::TimeDuration::fromSeconds(2.0));
}

double renderRate(const ProjectDoc& doc) {
    return doc.sampleRate > 0 ? static_cast<double>(doc.sampleRate) : 48000.0;
}


}  // namespace

/**
 * A headless engine: everything Tracktion needs to BUILD and render an edit, and no audio device.
 *
 * `te::Engine`'s constructor opens the default device unless its EngineBehaviour says otherwise, and an offline
 * render has no use for one — it writes a file. Opening it was not merely wasteful: a device the LIVE engine
 * already holds cannot be opened twice, so a render (or a freeze) launched while the transport existed would sit
 * in the constructor waiting, printing nothing, until something killed it. Measured on an EMPTY project, which is
 * what pinned it here rather than anywhere in the rendering.
 */
struct HeadlessBehaviour : te::EngineBehaviour {
    bool autoInitialiseDeviceManager() override { return false; }
};

// The engine both offline paths use. Constructed the same way in both, because they failed the same way.
std::unique_ptr<te::Engine> makeOfflineEngine() {
    auto engine = std::make_unique<te::Engine>("Studio", nullptr,
                                               std::make_unique<HeadlessBehaviour>());

    // Take the hosted-device route as well, for its ONE side effect: usesHardwareMidiDevices() turns false, so the
    // DeviceManager's rescan timer stops enumerating the machine's MIDI ports. A render has no use for them, and
    // the enumeration is not merely wasteful — juce::MidiInput::getAvailableDevices() is an RPC into midisrv.exe,
    // and a wedged MIDI service blocks it FOREVER, in every process on the machine. That is not hypothetical: it
    // is what stalled every render here for a night, from a Tracktion timer firing inside the sampler pump below.
    // Measured stack: midiInGetNumDevs -> NtAlpcSendWaitReceivePort, zero CPU, no output.
    // Do this before anything pumps the message loop, or the timer fires first and we are already waiting.
    te::HostedAudioDeviceInterface::Parameters p;
    p.useMidiDevices = false;
    engine->getDeviceManager().getHostedAudioDeviceInterface().initialise(p);
    return engine;
}


// Render the doc to <outDir>/mix.wav and, with `stems`, one wav per track, printing a JSON manifest.
// Returns 0 on success, non-zero when nothing was audible.
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

    if (!renderOne(dir.getChildFile("mix.wav"), trackBits(*edit, te::getAllTracks(*edit)), true)) {
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

// Bounce ONE track to `outFile` — the render a frozen track then plays instead of computing itself.
//
// This is the export's stem path with a different destination, and deliberately so: a stem is already "this track
// through its own plugins, with no master", which is exactly the freeze boundary. Nothing here has to work out
// where the track's chain stops, because the compiler settled that long before the doc arrived — a bus's modules
// are on the bus's own return track, never on this one's plugin list, so "up to OUT or up to a module fed by
// several inputs" is simply what this track's plugins ARE.
//
// The caller neutralises the track's gain, pan, mute and every solo in the song before handing the doc over: those
// stay live on a frozen track, and baking them in would apply each of them twice.
int freezeTrack(const ProjectDoc& doc, const std::string& baseDir, const std::string& trackId,
                const std::string& outFile) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    auto edit = buildRenderEdit(engine, doc, baseDir);

    // Matched by NAME, which is what populateEdit gives the Tracktion track, and what the id resolves to for every
    // track the compiler emits. Audio tracks only: a group has no material of its own to bake.
    auto tracks = te::getAudioTracks(*edit);
    te::Track* found = nullptr;
    for (auto* t : tracks)
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
        // A silent track is a real answer to "freeze this", but not one worth writing: the render would be a file
        // of zeroes that then plays in place of a track the user can still fix.
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
