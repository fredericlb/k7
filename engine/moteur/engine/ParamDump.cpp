// Plugin-parameter dump CLIs — see the dumpPluginParams / dumpPluginParamsExternal
// declarations in EngineHost.h. st0's text alternative to an opaque .vstpreset:
// enumerate a plugin's automatable parameters and print { params, complete } as
// sentinel-fenced JSON. `complete` means the params fully reproduce the plugin state
// (so the preset can be dropped).
//
// `pluginParamsOf` at the bottom is the one that is NOT a CLI: the socket's answer to "what
// does this plugin have", served from one offline engine kept for the run. See its comment for
// why that engine is shared, and docs/builtinParams.md for what reads the answer.

#include "EngineHost.h"

#include "EngineTypes.h"     // Tracktion/JUCE + the te/tt/fs aliases
#include "PluginScan.h"      // registerBuiltInPlugins / builtInPlugins
#include "PluginParams.h"    // paramsJson / currentParamValues / applyPluginParams / pluginParams
#include "EditBuilder.h"     // loadVstPreset — the ONE reader of a .vstpreset container
#include "Warnings.h"       // warn — an orphan belongs to no session, so it warns unstamped

#include <chrono>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>

namespace studio {

namespace {

// Sentinels fencing the params JSON, so the translator can find it amid any stdout printed while loading.
constexpr const char* kParamsBegin = "STUDIO_PARAMS_BEGIN";
constexpr const char* kParamsEnd = "STUDIO_PARAMS_END";

// Emit the fenced { params, complete } payload the translator parses: `complete` means the params fully
// reproduce the plugin state, so the opaque preset is safe to drop.
void emitParamsJson(const juce::String& params, bool complete) {
    std::cout << "\n" << kParamsBegin << "\n"
              << "{\"params\":" << params.toStdString()
              << ",\"complete\":" << (complete ? "true" : "false") << "}\n"
              << kParamsEnd << std::endl;
}

// A JSON string literal. Hand-rolled because a parameter name is a plugin author's, and Tracktion ships
// ones with quotes, slashes and non-ASCII in them.
std::string jsonStr(const juce::String& s) {
    return juce::JSON::toString(juce::var(s), true).toStdString();
}

// One number, printed so it round-trips through JSON.parse without a trailing `.0` problem or an
// `inf` that is not valid JSON — a plugin with an unbounded range does exist, and it must not
// produce a file the generator cannot read.
std::string jsonNum(double v) {
    if (!std::isfinite(v))
        return "null";
    std::ostringstream o;
    o.precision(10);
    o << v;
    return o.str();
}

}  // namespace

int dumpBuiltinParams() {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    registerBuiltInPlugins(engine);
    auto edit = te::Edit::createSingleTrackEdit(engine);

    // BOTH lists. AirWindows is 186 of the plugins a project can name, registered separately and
    // therefore missed the first time this walked only `builtInPlugins()` — which is exactly what
    // an empty panel on `@engine/chorus-ensemble` was.
    auto all = builtInPlugins();
    for (auto& aw : airWindowsPlugins())
        all.push_back(std::move(aw));

    std::ostringstream out;
    out << "{";
    bool firstPlugin = true;
    for (const auto& info : all) {
        // Created for real, and that is the whole point: a plugin's parameters are registered by its
        // CONSTRUCTOR (4OSC calls addParam 84 times there), so nothing short of an instance can list them.
        auto plugin = edit->getPluginCache().createNewPlugin(juce::String(info.identifier), {});
        if (plugin == nullptr) {
            std::cerr << "[dump-builtin-params] could not create '" << info.identifier << "'\n";
            continue;
        }
        // `withStates` ON: a discrete parameter's named settings are what makes a dropdown instead of a
        // slider, and this runs once rather than per state frame — the reason that flag defaults to off.
        const auto params = pluginParams(*plugin, true);
        out << (firstPlugin ? "" : ",") << jsonStr(juce::String(info.identifier)) << ":{"
            << "\"name\":" << jsonStr(juce::String(info.name))
            << ",\"role\":" << jsonStr(juce::String(info.role))
            << ",\"params\":[";
        firstPlugin = false;
        bool firstParam = true;
        for (const auto& p : params) {
            out << (firstParam ? "" : ",") << "{\"name\":" << jsonStr(p.name)
                << ",\"min\":" << jsonNum(p.min) << ",\"max\":" << jsonNum(p.max)
                << ",\"def\":" << (p.def.has_value() ? jsonNum(*p.def) : "null");
            if (!p.states.empty()) {
                out << ",\"states\":[";
                bool firstState = true;
                for (const auto& [label, value] : p.states) {
                    out << (firstState ? "" : ",") << "{\"label\":" << jsonStr(label)
                        << ",\"value\":" << jsonNum(value) << "}";
                    firstState = false;
                }
                out << "]";
            }
            out << "}";
            firstParam = false;
        }
        out << "]}";
        // Dropped before the next one is made: twenty-seven live plugins on one edit is not what any of
        // them expects, and an instrument holds voices.
        plugin->deleteFromParent();
    }
    out << "}";
    std::cout << "\n" << kParamsBegin << "\n" << out.str() << "\n" << kParamsEnd << std::endl;
    return 0;
}

int dumpPluginParams(const std::string& type) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    // Same built-ins the live host has, or this path silently renders without them.
    registerBuiltInPlugins(engine);
    auto edit = te::Edit::createSingleTrackEdit(engine);

    // A built-in, addressed by xmlTypeName: its state is entirely its parameters, so the dump is always complete.
    auto plugin = edit->getPluginCache().createNewPlugin(juce::String(type), {});
    if (plugin == nullptr) {
        std::cerr << "[dump-params] could not create plugin '" << type << "'\n";
        emitParamsJson("{}", false);
        return 2;
    }
    emitParamsJson(paramsJson(*plugin), true);
    return 0;
}

namespace {

/**
 * The PluginDescription a format and an identifier name, REGISTERED with the engine about to
 * create it — or false.
 *
 * The registration is not a detail, it is what makes the plugin LOAD. `createNewPlugin` builds an
 * `ExternalPlugin` from the description and then throws the description away: `initialiseFully`
 * looks the plugin up again, in `PluginManager::knownPluginList`, and instantiates nothing when
 * that search comes back empty. Nothing seeds that list here — the moteur runs no Tracktion scan
 * and persists no plugin list (`%APPDATA%/Studio/Settings.xml` has no `pluginList` key at all),
 * so on a fresh engine it is empty and EVERY external plugin fails, whatever the plugin is.
 *
 * What that looks like is why it goes unnoticed: Tracktion's `getLoadError()` answers "there is no
 * instance" with a sentence about the plugin — `ERROR! - This plugin couldn't be loaded!` — which
 * reads as a licence or an installation, a fact about the machine that no code could fix. It is
 * neither. `EditBuilder::makeExternalPlugin` carries this same one line, with a comment saying
 * why; any third site that creates an external plugin needs it too.
 *
 * No plugin CODE runs to find it — `findAllTypesForFile` reads the already-scanned type info off
 * the binary. Factored out because two callers resolve the same way and only one of them then
 * wants the plugin's state: the param query below simply creates it and asks what it has. Taking
 * the engine here rather than leaving the caller to remember is the point — a caller that forgets
 * registers nothing, and every plugin it asks about answers empty.
 */
bool describeExternal(te::Engine& engine, const std::string& formatName,
                      const std::string& identifier, juce::PluginDescription& desc) {
    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    for (auto* f : formats.getFormats()) {
        if (f->getName() != juce::String(formatName)) continue;
        juce::OwnedArray<juce::PluginDescription> types;
        f->findAllTypesForFile(types, juce::String(identifier));
        if (!types.isEmpty()) {
            desc = *types[0];
            engine.getPluginManager().knownPluginList.addType(desc);
            return true;
        }
        break;
    }
    return false;
}

}  // namespace

namespace {

/**
 * The offline engine every parameter query shares — built on the first ask, kept for the run.
 *
 * ONE PER PROCESS, not one per question, and that difference is the whole of this. A `te::Engine`
 * per query, built and destroyed on the way out, kills the engine after forty of them in a row —
 * twice, measured on a pass that drew a panel for every module in a library of two hundred and
 * sixty. Nothing in Tracktion promises that constructing and tearing down whole engines beside a
 * live one is safe, and it is not.
 *
 * That ONE engine can host every plugin in turn is not a hope: `dumpBuiltinParams` above creates
 * two hundred and twelve of them in a single edit, one at a time. Keeping the engine alive between
 * calls also makes a batch far cheaper, since building the engine is most of what a query costs.
 *
 * Still an engine of its own rather than the live host's: that one holds the audio interface,
 * and an ASIO driver is single-client — a query that borrowed it would wedge the thing making
 * sound. `makeOfflineEngine` opens no device.
 *
 * LEAKED deliberately — `new`, never deleted. A destructor would run at process exit in an order
 * nothing here controls, which is the same teardown crash moved to the end of the run.
 */
struct ParamQueryEngine {
    juce::ScopedJuceInitialiser_GUI juceInit;
    std::unique_ptr<te::Engine> engine;
    std::unique_ptr<te::Edit> edit;
};

/** Serialises the queries: one edit, and two plugins being built into it at once is not a thing
 *  Tracktion offers. Costs the caller nothing it was not already spending — the ask is seconds. */
std::mutex paramQueryMutex;

/** How long a plugin gets to finish loading before we report what it has. */
constexpr int kParamListTimeoutMs = 15000;

/**
 * Wait until the plugin has actually BUILT its parameter list, and say so if it never does.
 *
 * `createNewPlugin` does not always come back with a loaded plugin. Tracktion asks
 * `requiresAsyncInstantiation` and, for the plugins that say yes, creates the instance on a
 * background thread — `ExternalPlugin::startPluginInstanceCreation`. `buildParameterList()` then
 * runs inside the completion callback, later, on the message thread. Ask before that lands and the
 * plugin truthfully reports NOTHING.
 *
 * The tell that a zero is about the LOAD and never about the plugin: `buildParameterList` adds
 * `dryGain` and `wetGain` unconditionally, before it looks at the instance at all, so anything
 * loaded reports at least two. Zero cannot mean "it has none" — only that the list was never
 * built. That is what this waits on, rather than on the `isInitialisingAsync` flag: the flag is
 * cleared at the top of `completePluginInstanceCreation` and the list is built at the bottom of
 * it, so watching the flag would reopen the same race a few lines narrower.
 *
 * Waiting is only half of it. `createNewPlugin` hands back a Plugin whether or not an instance was
 * ever made — that object is what draws a red box in a project whose plugin is missing — so a
 * plugin that never loaded also sits here reporting zero, for ever. Saying so rather than
 * answering "this plugin publishes nothing" is why this returns a bool at all.
 *
 * What it must NOT be read as is a verdict on the plugin. A plugin nothing has registered with this
 * engine is never ASKED to load: Tracktion looks the description up, finds nothing, builds no
 * instance — and `getLoadError` reports that absence in the words of a plugin that failed (see
 * `describeExternal`). Read that way, twenty-seven of forty external plugins "never load at all",
 * Arturia's CS-80 V4, Prophet-5 V, DX7 V and Piano V3 among them, which sends you to a licence or an
 * installation. Every one of them loads: CS-80 V4 answers with 719 parameters, Prophet-5 V with 603,
 * Piano V3 with 151.
 *
 * The lesson worth keeping: a zero here says something about this PROCESS at least as often as
 * about the machine, so read the two apart before believing a sentence Tracktion wrote about
 * somebody else's binary.
 */
bool waitForParameterList(te::Plugin& plugin, const std::string& identifier) {
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(kParamListTimeoutMs);
    while (plugin.getNumAutomatableParameters() == 0) {
        // Not merely slow — REFUSED. `createNewPlugin` hands back a Plugin whatever happens; that
        // object is what draws a red box in a project whose plugin is missing, so "not null" has
        // never meant "loaded". `getLoadError` is the question that does, and it is empty while an
        // async load is still in flight, so it is only conclusive once nothing is in flight.
        if (ext && !ext->isInitialisingAsync()) {
            const auto err = ext->getLoadError();
            if (err.isNotEmpty()) {
                std::cerr << "[plugin-params] '" << identifier
                          << "' did not load: " << err.toStdString() << "\n";
                return false;
            }
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            std::cerr << "[plugin-params] '" << identifier << "' still had no parameter list after "
                      << kParamListTimeoutMs << "ms — reporting what it has\n";
            return true;
        }
        // Slept, not pumped: this runs on the socket's detached thread, and the callback that
        // builds the list is dispatched to the MESSAGE thread, which the server is already
        // running. Pumping from here would be a second thread claiming the message loop.
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return true;
}

ParamQueryEngine& paramQueryEngine() {
    static ParamQueryEngine* held = [] {
        auto* q = new ParamQueryEngine();
        q->engine = makeOfflineEngine();
        registerBuiltInPlugins(*q->engine);
        q->edit = te::Edit::createSingleTrackEdit(*q->engine);
        return q;
    }();
    return *held;
}

/**
 * The orphans being kept alive, keyed by format and identifier. Never emptied.
 *
 * `pluginParamsOf` drops its plugin the moment it has read the list, and says why: an instrument
 * left on the shared edit holds voices and a binary open. An orphan opened for its own WINDOW
 * cannot be dropped on the same principle — the window is still on screen and the user is turning
 * its knobs — so it is held instead, one per plugin, until the process ends. A handful of loaded
 * synths is what the feature costs, and it buys a reopen that is a visibility flip rather than
 * another fourteen seconds of loading.
 */
std::unordered_map<std::string, te::Plugin::Ptr> orphanPlugins;

/** Format and identifier as one map key. A newline, because neither half can contain one. */
std::string orphanKey(const std::string& formatName, const std::string& identifier) {
    return formatName + "\n" + identifier;
}

}  // namespace

te::Plugin::Ptr orphanPluginFor(const std::string& formatName, const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);
    const auto key = orphanKey(formatName, identifier);
    if (auto it = orphanPlugins.find(key); it != orphanPlugins.end() && it->second != nullptr)
        return it->second;

    auto& shared = paramQueryEngine();
    juce::PluginDescription desc;
    if (!describeExternal(*shared.engine, formatName, identifier, desc)) {
        warn("no " + formatName + " plugin at '" + identifier + "'");
        return {};
    }
    auto plugin =
        shared.edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    if (plugin == nullptr) {
        warn("could not create '" + identifier + "'");
        return {};
    }
    // The same wait, and the same reading of it: a plugin this machine refuses to load reports an
    // empty parameter list for ever, and telling that apart from "it has none" is the whole of it.
    // Sleeping rather than pumping is safe even when this runs on the message thread, because every
    // format this engine hosts builds its instance synchronously — see the note in AGENTS.md.
    if (!waitForParameterList(*plugin, identifier)) {
        plugin->deleteFromParent();
        warn("'" + identifier + "' did not load — a licence or an installation, not the plugin");
        return {};
    }
    orphanPlugins[key] = plugin;
    return plugin;
}

te::Plugin::Ptr orphanPluginIfLoaded(const std::string& formatName,
                                     const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);
    auto it = orphanPlugins.find(orphanKey(formatName, identifier));
    return it == orphanPlugins.end() ? te::Plugin::Ptr{} : it->second;
}

bool prepareNativePluginUI(const std::string& formatName, const std::string& identifier) {
    return orphanPluginFor(formatName, identifier) != nullptr;
}

std::optional<std::vector<PluginParamInfo>> pluginParamsOf(const std::string& formatName,
                                                           const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);
    auto& shared = paramQueryEngine();

    juce::PluginDescription desc;
    if (!describeExternal(*shared.engine, formatName, identifier, desc)) {
        std::cerr << "[plugin-params] no " << formatName << " plugin at '" << identifier << "'\n";
        return std::nullopt;
    }
    auto plugin =
        shared.edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    if (plugin == nullptr) {
        std::cerr << "[plugin-params] could not create '" << identifier << "'\n";
        return std::nullopt;
    }
    // A plugin this machine cannot LOAD is `nullopt`, exactly like one it cannot find: both are
    // "no answer about this plugin", and neither is "this plugin has no parameters".
    if (!waitForParameterList(*plugin, identifier)) {
        plugin->deleteFromParent();
        return std::nullopt;
    }
    std::vector<PluginParamInfo> out;
    // `withStates` ON, as the built-in dump has it: a discrete parameter's named settings are
    // what make a dropdown instead of a slider, and this runs once per ASK rather than per frame.
    for (const auto& p : pluginParams(*plugin, true)) {
        PluginParamInfo info;
        info.name = p.name.toStdString();
        info.min = p.min;
        info.max = p.max;
        info.hasDefault = p.def.has_value();
        info.def = p.def.value_or(0.0);
        for (const auto& [label, value] : p.states)
            info.states.emplace_back(label.toStdString(), value);
        out.push_back(std::move(info));
    }
    // Dropped before the next query is served, as the built-in dump drops each of its own: the
    // edit outlives this call now, and an instrument left on it holds voices and a binary open.
    plugin->deleteFromParent();
    return out;
}

int dumpPluginParamsExternal(const std::string& formatName, const std::string& identifier,
                             const std::string& stateFile) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    // Same built-ins the live host has, or this path silently renders without them.
    registerBuiltInPlugins(engine);
    auto edit = te::Edit::createSingleTrackEdit(engine);

    juce::PluginDescription desc;
    if (!describeExternal(engine, formatName, identifier, desc)) {
        std::cerr << "[dump-params-ext] no " << formatName << " plugin at '" << identifier << "'\n";
        emitParamsJson("{}", false);
        return 2;
    }

    // Instantiate the external plugin and restore its state from the .vstpreset.
    auto plugin = edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    auto* ext = dynamic_cast<te::ExternalPlugin*>(plugin.get());
    if (ext == nullptr) {
        std::cerr << "[dump-params-ext] could not create external plugin\n";
        emitParamsJson("{}", false);
        return 2;
    }
    // `loadVstPreset`, not `setStateInformation`, and the difference is the whole point of this CLI.
    //
    // A .vstpreset is a Steinberg PresetFile — a container, with a header, the plugin's class id and
    // chunk offsets around the state. `setStateInformation` expects JUCE's own VST3 state format, so
    // handed the raw container it takes none of it and returns void: no error, no exception, nothing
    // to test. What it prints then is the fresh instance's defaults, `complete: true`, with the same
    // 77 parameters for a saved Mini V3 patch as for a plugin never touched — a confident answer to
    // a question it never asked, and the translator writes those defaults into the chain as the
    // musician's sound.
    //
    // `EditBuilder::loadVstPreset` parses the container properly
    // (`VST3PluginFormat::setStateFromVSTPresetFile`), and both the rack load and the editor's
    // preset-picker go through it. Be its third caller rather than a second hand-rolled parser.
    if (!loadVstPreset(*plugin, juce::File(juce::String(stateFile))))
        std::cerr << "[dump-params-ext] no state applied from '" << stateFile
                  << "' — the params below are the plugin's own defaults\n";

    const auto params = paramsJson(*plugin);
    const auto values = currentParamValues(*plugin);

    // Completeness: a fresh instance carrying only these params must reproduce the exact state. Only then is
    // dropping the opaque preset lossless.
    //
    // Expect `false` from the big commercial instruments, and do not go looking for the bug. Their
    // patch is not in their automatable parameters: an Arturia Wurli V2 loaded from a .vstpreset
    // reports the same 50 values as an untouched one, and Mini V3 the same 77 — checked against the
    // JUCE `AudioProcessorParameter`s directly, not just Tracktion's cache in front of them, so this
    // is the plugin's own answer and not a value gone stale. What the preset changed is opaque
    // chunk state, which is exactly what `complete: false` is for: keep the .vstpreset. A `true`
    // reached through a state load that applied NOTHING is the damage to fear — the round-trip
    // matches trivially, and the translator drops a preset for the defaults.
    bool complete = false;
    if (auto* inst = ext->getAudioPluginInstance()) {
        juce::MemoryBlock a;
        inst->getStateInformation(a);
        auto plugin2 = edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
        if (auto* ext2 = dynamic_cast<te::ExternalPlugin*>(plugin2.get())) {
            applyPluginParams(*plugin2, values);
            if (auto* inst2 = ext2->getAudioPluginInstance()) {
                juce::MemoryBlock b;
                inst2->getStateInformation(b);
                complete = (a == b);
            }
        }
        // Handed back like every other instance in this file: left alone, the comparison instance
        // sits in the cache until the Edit goes.
        plugin2->deleteFromParent();
    }
    emitParamsJson(params, complete);

    // The answer is printed; now let the message thread actually FREE the plugins, which is not
    // something their destructors do. `~ExternalPlugin` hands the instance to Tracktion's
    // `AsyncPluginDeleter`, which parks it in an array and starts a 100 ms `juce::Timer` — one
    // instance freed per fire. The server and the tray run a message loop, so that timer fires; a
    // CLI runs none, so without this both instances are still alive when JUCE's shutdown reaches
    // `DeletedAtShutdown` and the deleter's destructor drains them itself, entering a modal state
    // on a Component in the middle of teardown.
    //
    // That is an intermittent SIGSEGV *after* a perfect answer has been printed: 7 of 32 runs without
    // this pump, 0 of 32 with it, on Arturia's Prophet-5 V, CS-80 V4 and Jup-8 V4. Intermittent and
    // load-dependent — it disappears for twenty clean runs and comes back — so measure it over a
    // batch, never on one run. And it is the worst shape available, because `execFileSync` in the
    // translator (`packages/translator/src/params.ts`) raises on a non-zero exit and throws away the
    // dump it already has: a perfect answer read as "the engine returned no params".
    //
    // Same remedy and the same reason as `drainMessageQueue` in OfflineRender.cpp; longer than that
    // one's 200 ms because the deleter frees ONE plugin per fire and this path makes two.
    plugin->deleteFromParent();
    plugin = nullptr;  // the cache's reference is gone with deleteFromParent; this drops ours
    juce::MessageManager::getInstance()->runDispatchLoopUntil(500);
    return 0;
}

}  // namespace studio
