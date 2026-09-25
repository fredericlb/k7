// Plugin discovery, out-of-process, cached in `<state>/exts.json` — see
// PluginScan.h and the CLI declarations in EngineHost.h. Each plugin is loaded in a
// child process (runPluginScanChild), so a crashy plugin only kills its own child.

#include "EngineHost.h"

#include "EngineTypes.h"    // Tracktion/JUCE + the te/tt/fs aliases
#include "ArpeggiatorPlugin.h"
#include "FaustPlugin.h"
#include "GraphDspPlugin.h"
#include "MasterGainPlugin.h"
#include "MixerPlugin.h"
#include "MidiGraphPlugin.h"
#include "NamPlugin.h"
#include "QuickMasterPlugin.h"
#include "TurntablePlugin.h"
#include "PatternPlugin.h"
#include "BroadcastTapPlugin.h"     // likewise, for the network broadcast tap
#include "WaveformTapPlugin.h"      // its xmlTypeName, listed among the built-ins below
#include "RecorderPlugin.h"         // …and the recorder NODE, which the document declares
#include "PluginScan.h"     // cachedPluginInfos / invalidatePluginInfoMemo

#include <algorithm>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace studio {

// The scan cache parsed once and reused, under a mutex and handed out as a shared snapshot — docs/plugins.md.
namespace {
std::mutex g_pluginInfoMx;
std::shared_ptr<const std::vector<PluginInfo>> g_pluginInfoMemo;
}  // namespace

std::shared_ptr<const std::vector<PluginInfo>> cachedPluginInfos() {
    std::lock_guard<std::mutex> lk(g_pluginInfoMx);
    if (!g_pluginInfoMemo)
        g_pluginInfoMemo = std::make_shared<const std::vector<PluginInfo>>(loadPluginCache());
    return g_pluginInfoMemo;
}
void invalidatePluginInfoMemo() {
    std::lock_guard<std::mutex> lk(g_pluginInfoMx);
    g_pluginInfoMemo.reset();
}

namespace {

// Sentinels the child fences its JSON with, so the parent can find it amid any stdout a plugin prints.
constexpr const char* kScanBegin = "STUDIO_SCAN_BEGIN";
constexpr const char* kScanEnd = "STUDIO_SCAN_END";

// `<state>` must be the one studioHome.ts computes, never a second spelling — docs/plugins.md.
juce::File extsCacheFile() {
    const auto env = juce::SystemStats::getEnvironmentVariable("STUDIO_HOME", {});
    auto dir = env.isNotEmpty()
        ? juce::File(env)
        : juce::File::getSpecialLocation(juce::File::userHomeDirectory)
              .getChildFile(".st0");
    dir.createDirectory();
    return dir.getChildFile("exts.json");
}

juce::var pluginToVar(const PluginInfo& p) {
    auto* o = new juce::DynamicObject();
    o->setProperty("name", juce::String(p.name));
    o->setProperty("format", juce::String(p.format));
    o->setProperty("manufacturer", juce::String(p.manufacturer));
    o->setProperty("id", juce::String(p.identifier));
    o->setProperty("instrument", p.isInstrument);
    o->setProperty("role", juce::String(p.role));
    if (!p.descXml.empty()) o->setProperty("desc", juce::String(p.descXml));
    if (!p.category.empty()) o->setProperty("category", juce::String(p.category));
    return juce::var(o);
}

PluginInfo pluginFromVar(const juce::var& v, const std::string& fallbackId,
                         const std::string& fallbackFormat) {
    const bool inst = (bool)v.getProperty("instrument", false);
    // Older caches lack role — derive from isInstrument as a fallback.
    std::string role = v.getProperty("role", "").toString().toStdString();
    if (role.empty())
        role = inst ? "instrument" : "audioEffect";
    return {
        v.getProperty("name", "").toString().toStdString(),
        v.getProperty("format", juce::String(fallbackFormat)).toString().toStdString(),
        v.getProperty("manufacturer", "").toString().toStdString(),
        v.getProperty("id", juce::String(fallbackId)).toString().toStdString(),
        inst,
        role,
        v.getProperty("desc", "").toString().toStdString(),
        v.getProperty("category", "").toString().toStdString(),
    };
}

// One cache entry: the plugin(s) at a file plus the mtime we scanned it at, so a changed one is re-scanned.
struct CacheEntry {
    juce::int64 mtime = 0;
    std::vector<PluginInfo> plugins;
};
using Cache = std::map<std::string, CacheEntry>;   // identifier -> entry

Cache loadCacheMap() {
    Cache cache;
    const auto file = extsCacheFile();
    if (!file.existsAsFile())
        return cache;
    const auto root = juce::JSON::parse(file);
    if (auto* arr = root.getProperty("entries", juce::var()).getArray())
        for (const auto& ev : *arr) {
            const std::string id = ev.getProperty("id", "").toString().toStdString();
            if (id.empty())
                continue;
            CacheEntry e;
            e.mtime = ev.getProperty("mtime", "0").toString().getLargeIntValue();
            if (auto* parr = ev.getProperty("plugins", juce::var()).getArray())
                for (const auto& pv : *parr)
                    e.plugins.push_back(pluginFromVar(pv, id, ""));
            cache[id] = std::move(e);
        }
    return cache;
}

void saveCacheMap(const Cache& cache) {
    juce::Array<juce::var> entries;
    for (const auto& [id, e] : cache) {
        auto* eo = new juce::DynamicObject();
        eo->setProperty("id", juce::String(id));
        eo->setProperty("mtime", e.mtime);
        juce::Array<juce::var> plugs;
        for (const auto& p : e.plugins)
            plugs.add(pluginToVar(p));
        eo->setProperty("plugins", juce::var(plugs));
        entries.add(juce::var(eo));
    }
    auto* root = new juce::DynamicObject();
    root->setProperty("entries", juce::var(entries));
    extsCacheFile().replaceWithText(juce::JSON::toString(juce::var(root)));
}

// Load ONE plugin in a child process; empty when the child crashed or found nothing.
std::vector<PluginInfo> scanOne(const juce::File& exe, juce::AudioPluginFormat& format,
                                const juce::String& identifier) {
    std::vector<PluginInfo> out;
    const auto name = juce::File(identifier).getFileName();

    juce::ChildProcess child;
    // start(StringArray) escapes args with spaces on Windows, so a "C:\Program Files\…" path reaches the child's argv intact.
    const juce::StringArray args{exe.getFullPathName(), "--scan-plugin", format.getName(), identifier};
    if (!child.start(args, juce::ChildProcess::wantStdOut)) {
        std::cerr << "[scanOne] start FAILED: " << name << "\n";
        return out;
    }

    // Capture stdout on a helper thread (readAllProcessOutput blocks until the child exits) and bound the wait, so a hung plugin is killed.
    juce::String output;
    std::thread reader([&child, &output] { output = child.readAllProcessOutput(); });
    if (!child.waitForProcessToFinish(20000)) {
        child.kill();
        std::cerr << "[scanOne] TIMEOUT: " << name << "\n";
    }
    reader.join();

    const int b = output.indexOf(kScanBegin);
    const int e = output.indexOf(kScanEnd);
    if (b < 0 || e < 0 || e <= b) {
        std::cerr << "[scanOne] no sentinels (outLen=" << output.length()
                  << " exit=" << (int)child.getExitCode() << "): " << name << "\n";
        return out;
    }
    const auto jsonStr = output.substring(b + (int)juce::String(kScanBegin).length(), e).trim();
    const auto parsed = juce::JSON::parse(jsonStr);
    if (auto* arr = parsed.getArray())
        for (const auto& v : *arr)
            out.push_back(pluginFromVar(v, identifier.toStdString(), format.getName().toStdString()));
    else
        std::cerr << "[scanOne] JSON parse failed for " << name << ": " << jsonStr.toStdString() << "\n";
    return out;
}

}  // namespace

// Tracktion's built-in plugins plus ours, always available without scanning; the id is each one's xmlTypeName. See docs/plugins.md.
std::vector<PluginInfo> builtInPlugins() {
    // The category is assigned rather than derived: a built-in declares none, and the vocabulary is the AirWindows enum's.
    const auto e = [](const char* nm, juce::String type, const char* role,
                      const char* category = "") {
        return PluginInfo{nm, "internal", "Tracktion", type.toStdString(), role[0] == 'i',
                          std::string(role), {}, std::string(category)};
    };
    return {
        e("4OSC", te::FourOscPlugin::xmlTypeName, "instrument", "instrument"),
        e("Sampler", te::SamplerPlugin::xmlTypeName, "instrument", "instrument"),
        e("Volume & Pan", te::VolumeAndPanPlugin::xmlTypeName, "audioEffect", "utility"),
        e("VCA", te::VCAPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Level Meter", te::LevelMeterPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Equaliser", te::EqualiserPlugin::xmlTypeName, "audioEffect", "eq"),
        e("Reverb", te::ReverbPlugin::xmlTypeName, "audioEffect", "reverb"),
        e("Compressor", te::CompressorPlugin::xmlTypeName, "audioEffect", "dynamics"),
        e("Chorus", te::ChorusPlugin::xmlTypeName, "audioEffect", "modulation"),
        e("Delay", te::DelayPlugin::xmlTypeName, "audioEffect", "delay"),
        e("Phaser", te::PhaserPlugin::xmlTypeName, "audioEffect", "modulation"),
        e("Pitch Shifter", te::PitchShiftPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Low-Pass Filter", te::LowPassPlugin::xmlTypeName, "audioEffect", "filter"),
        e("MIDI Modifier", te::MidiModifierPlugin::xmlTypeName, "midiEffect", "utility"),
        e("MIDI Patch Bay", te::MidiPatchBayPlugin::xmlTypeName, "midiEffect", "utility"),
        e("Patch Bay", te::PatchBayPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Aux Send", te::AuxSendPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Aux Return", te::AuxReturnPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Text", te::TextPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Freeze Point", te::FreezePointPlugin::xmlTypeName, "audioEffect", "utility"),
        e("Insert", te::InsertPlugin::xmlTypeName, "audioEffect", "utility"),
        // A convolver, so a cabinet or a room is an audio FILE the project owns rather than a path inside some plugin's opaque state.
        e("Impulse Response", te::ImpulseResponsePlugin::xmlTypeName, "audioEffect", "reverb"),
        // The amp itself rather than its cabinet: a .nam model's non-linear behaviour, filed under what it does to the signal.
        e("Neural Amp Modeler", studio::NamPlugin::xmlTypeName, "audioEffect", "distortion"),
        // DSP described as DATA rather than compiled in (DspGraph.h): its parameters come from the description, so two graphs look different.
        e("DSP Graph", studio::GraphDspPlugin::xmlTypeName, "audioEffect", "filter"),
        // The same idea with the compiler on THIS side: the module carries Faust source, and what this build does with it is docs/faust.md.
        e("Faust", studio::FaustPlugin::xmlTypeName, "audioEffect", "utility"),
        // The same idea over the note stream; `midiEffect` is what files the module under transformers/ and puts it BEFORE the instrument.
        e("MIDI Graph", studio::MidiGraphPlugin::xmlTypeName, "midiEffect", "utility"),
        // A chord held down and played one note at a time — a note SOURCE, which no graph node can be (docs/arpeggiator.md).
        e("Arpeggiator", studio::ArpeggiatorPlugin::xmlTypeName, "midiEffect", "utility"),
        // The channel strip: level, pan and a tone stack. A track carries none itself, so this is where a mix is made, one per track.
        e("Mixer", studio::MixerPlugin::xmlTypeName, "audioEffect", "utility"),
        // A tape machine you drop in a chain: transparent, and it captures — docs/recorder.md.
        e("Recorder", studio::RecorderPlugin::xmlTypeName, "audioEffect", "utility"),
        // A master bus in one module: three bands compressed, a spreader, a limiter (docs/quickMaster.md).
        e("Quick Master", studio::QuickMasterPlugin::xmlTypeName, "audioEffect", "dynamics"),
    };
}

// The AirWindows effects, listed from the same X-macro that DECLARES them rather than retyped — docs/airWindowsList.md.
std::vector<PluginInfo> airWindowsPlugins() {
    std::vector<PluginInfo> out;
   #if TRACKTION_AIR_WINDOWS
    #define AIRWINDOWS(className, pluginName, category)                                out.push_back(PluginInfo{pluginName, "internal", "AirWindows",                                          te::className::xmlTypeName, false,                                             "audioEffect", {}, category});
    #include "AirWindowsList.h"
    #undef AIRWINDOWS
   #endif
    return out;
}

// The registrations that MUST match builtInPlugins() above, and are kept adjacent for that reason — docs/plugins.md.
void registerBuiltInPlugins(te::Engine& engine) {
    auto& pm = engine.getPluginManager();
    // Ours.
    pm.createBuiltInType<studio::WaveformTapPlugin>();
    pm.createBuiltInType<studio::BroadcastTapPlugin>();
    pm.createBuiltInType<studio::NamPlugin>();
    pm.createBuiltInType<studio::GraphDspPlugin>();
    pm.createBuiltInType<studio::FaustPlugin>();
    pm.createBuiltInType<studio::MidiGraphPlugin>();
    pm.createBuiltInType<studio::ArpeggiatorPlugin>();
    pm.createBuiltInType<studio::MixerPlugin>();
    pm.createBuiltInType<studio::RecorderPlugin>();
    pm.createBuiltInType<studio::QuickMasterPlugin>();
    pm.createBuiltInType<studio::TurntablePlugin>();
    // Registered but not LISTED, like the platter: the song compile puts it on a pattern lane, no module names it.
    pm.createBuiltInType<studio::PatternPlugin>();
    // Registered so the plugin cache can create one, and deliberately ABSENT from the catalogue above — see MasterGainPlugin.h.
    pm.createBuiltInType<studio::MasterGainPlugin>();
    // Tracktion SHIPS the convolver and the 186 AirWindows effects but registers neither, so both were dead weight in the binary.
    pm.createBuiltInType<te::ImpulseResponsePlugin>();
    pm.initialiseAirWindows();
}

std::vector<PluginInfo> loadPluginCache() {
    // The built-ins come from the CODE and are listed FIRST, so a stale `builtin:*` entry from an older scan loses to the live one.
    std::vector<PluginInfo> out = builtInPlugins();
    for (auto& aw : airWindowsPlugins())
        out.push_back(std::move(aw));
    std::set<std::string> have;
    for (const auto& p : out)
        have.insert(p.identifier);

    for (const auto& [id, e] : loadCacheMap())
        for (const auto& p : e.plugins)
            if (p.format != "internal" || have.insert(p.identifier).second)
                out.push_back(p);
    return out;
}

std::vector<PluginInfo> scanInstalledPlugins(bool forceRescan) {
    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    const auto exe = juce::File::getSpecialLocation(juce::File::currentExecutableFile);

    // Diagnostics to the engine log, so an empty result is debuggable: which formats are compiled in, and counts.
    std::cerr << "[scan] formats:";
    for (auto* f : formats.getFormats()) std::cerr << " " << f->getName();
    std::cerr << (forceRescan ? "  (force)\n" : "\n");

    const Cache old = forceRescan ? Cache{} : loadCacheMap();
    Cache fresh;
    std::vector<PluginInfo> result;
    int totalFiles = 0, loaded = 0;

    for (auto* format : formats.getFormats()) {
        const auto files =
            format->searchPathsForPlugins(format->getDefaultLocationsToSearch(), true, false);
        std::cerr << "[scan] " << format->getName() << ": " << files.size() << " file(s)\n";
        totalFiles += files.size();

        int i = 0;
        for (const auto& identifier : files) {
            ++i;
            const std::string id = identifier.toStdString();
            const juce::int64 mtime = juce::File(identifier).getLastModificationTime().toMilliseconds();

            // Reuse a cached entry only when the file is unchanged AND it carries a full description, so a plain rescan upgrades older ones.
            const auto it = old.find(id);
            const bool cachedHasDesc =
                it != old.end() && !it->second.plugins.empty() &&
                std::all_of(it->second.plugins.begin(), it->second.plugins.end(),
                            [](const PluginInfo& pi) { return !pi.descXml.empty(); });
            if (it != old.end() && it->second.mtime == mtime && cachedHasDesc) {
                fresh[id] = it->second;                              // unchanged -> reuse cache
            } else {
                // Live progress: what we're loading right now (flushed immediately).
                std::cerr << "[scan] (" << i << "/" << files.size() << ") scanning "
                          << juce::File(identifier).getFileName() << std::endl;
                fresh[id] = {mtime, scanOne(exe, *format, identifier)};  // new/changed -> load
                ++loaded;
            }

            for (const auto& p : fresh[id].plugins)
                result.push_back(p);
        }
    }

    // Built-ins have no file to scan, so they are keyed "builtin:<type>" and survive incremental scans that only touch enumerated files.
    auto builtins = builtInPlugins();
    // The AirWindows effects join them: also built-in and file-less, just from a generated list.
    for (auto& aw : airWindowsPlugins())
        builtins.push_back(std::move(aw));
    for (const auto& p : builtins) {
        fresh["builtin:" + p.identifier] = CacheEntry{0, {p}};
        result.push_back(p);
    }
    std::cerr << "[scan] + " << builtins.size() << " built-in plugin(s)\n";

    std::cerr << "[scan] " << totalFiles << " file(s) enumerated, " << loaded << " loaded this pass, "
              << result.size() << " plugin(s) total -> " << extsCacheFile().getFullPathName() << "\n";

    saveCacheMap(fresh);   // fresh holds only current files -> uninstalled plugins drop out
    invalidatePluginInfoMemo();  // the cache changed — reload it on the next plugin lookup
    return result;
}

int runPluginScanChild(const std::string& formatName, const std::string& identifier) {
    juce::ScopedJuceInitialiser_GUI juceInit;

    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();

    juce::AudioPluginFormat* format = nullptr;
    for (auto* f : formats.getFormats())
        if (f->getName() == juce::String(formatName)) {
            format = f;
            break;
        }
    if (format == nullptr)
        return 2;

    juce::OwnedArray<juce::PluginDescription> found;
    // The crash-prone step — loading the plugin — isolated in this child process.
    format->findAllTypesForFile(found, juce::String(identifier));

    juce::Array<juce::var> arr;
    for (auto* d : found) {
        // Keep the FULL description as XML, so the engine can instantiate later without reloading the binary.
        auto xml = d->createXml();
        // Derive role: instrument, midiEffect (0 audio in+out), or audioEffect.
        std::string role = d->isInstrument ? "instrument"
            : (d->numInputChannels == 0 && d->numOutputChannels == 0) ? "midiEffect"
            : "audioEffect";
        arr.add(pluginToVar({d->name.toStdString(), d->pluginFormatName.toStdString(),
                             d->manufacturerName.toStdString(), d->fileOrIdentifier.toStdString(),
                             d->isInstrument, role,
                             xml ? xml->toString().toStdString() : std::string{},
                             d->category.toLowerCase().toStdString()}));
    }

    std::cout << "\n" << kScanBegin << "\n"
              << juce::JSON::toString(juce::var(arr)).toStdString() << "\n"
              << kScanEnd << std::endl;
    return 0;
}

int runPluginScanCli(bool forceRescan) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    const auto plugins = scanInstalledPlugins(forceRescan);
    std::cout << "scanned " << plugins.size() << " plugin(s)"
              << (forceRescan ? " (full rescan)" : "") << ":\n";
    for (const auto& p : plugins) {
        const char* tag = p.role == "instrument" ? "[inst]" :
                          p.role == "midiEffect" ? "[midi]" : "      ";
        std::cout << "  " << tag << " " << p.name << "  ["
                  << p.format << "]  " << p.manufacturer << "\n";
    }
    return 0;
}

}  // namespace studio
