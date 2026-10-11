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
#include "MessagePump.h"    // pumpMessages — the drain before a CLI returns
#if STUDIO_SURGE
#include "surge/SurgeCore.h" // the layout a Surge panel is generated from
#endif

#include <chrono>
#include <future>
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

// Emit the fenced { params, complete } payload the translator parses; `complete` means the opaque preset is safe to drop.
void emitParamsJson(const juce::String& params, bool complete) {
    std::cout << "\n" << kParamsBegin << "\n"
              << "{\"params\":" << params.toStdString()
              << ",\"complete\":" << (complete ? "true" : "false") << "}\n"
              << kParamsEnd << std::endl;
}

// A JSON string literal, hand-rolled because a parameter name is a plugin author's — quotes, slashes and non-ASCII included.
std::string jsonStr(const juce::String& s) {
    return juce::JSON::toString(juce::var(s), true).toStdString();
}

// One number, printed so it round-trips through JSON.parse — an `inf` is not valid JSON, and a plugin with an unbounded range exists.
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

    // BOTH lists: AirWindows is 186 more plugins a project can name, and walking only builtInPlugins() left every one of them without a panel.
    auto all = builtInPlugins();
    for (auto& aw : airWindowsPlugins())
        all.push_back(std::move(aw));

    std::ostringstream out;
    out << "{";
    bool firstPlugin = true;
    for (const auto& info : all) {
        // Created for real: a plugin registers its parameters in its CONSTRUCTOR, so nothing short of an instance can list them.
        auto plugin = edit->getPluginCache().createNewPlugin(juce::String(info.identifier), {});
        if (plugin == nullptr) {
            std::cerr << "[dump-builtin-params] could not create '" << info.identifier << "'\n";
            continue;
        }
        // `withStates` ON: named settings make a dropdown rather than a slider, and this runs once rather than per state frame.
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
            // Said only when false: a curve on such a control is refused by the compile rather than lost in the engine.
            if (!p.automatable) out << ",\"automatable\":false";
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
        // Dropped before the next one is made: an instrument holds voices, and this edit would otherwise carry every built-in at once.
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

/** The PluginDescription a format and an identifier name, REGISTERED with the engine about to create it — docs/plugins.md — or false. */
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

/** The offline engine every parameter query shares: one per process, kept for the run, leaked deliberately — docs/plugins.md. */
struct ParamQueryEngine {
    juce::ScopedJuceInitialiser_GUI juceInit;
    std::unique_ptr<te::Engine> engine;
    std::unique_ptr<te::Edit> edit;
};

/** Serialises the queries: one edit, and two plugins being built into it at once is not a thing Tracktion offers. */
std::mutex paramQueryMutex;

/** How long a plugin gets to finish loading before we report what it has. */
constexpr int kParamListTimeoutMs = 15000;

/** Wait until the plugin has actually BUILT its parameter list, and say so if it never does — how to read a zero: docs/plugins.md. */
bool waitForParameterList(te::Plugin& plugin, const std::string& identifier) {
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(kParamListTimeoutMs);
    while (plugin.getNumAutomatableParameters() == 0) {
        // Not merely slow — REFUSED. "Not null" never meant "loaded"; getLoadError is the question that does, once nothing is in flight.
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
        // Slept, not pumped: this runs on the socket's detached thread, and pumping would be a second thread claiming the message loop.
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return true;
}

/** Runs `fn` on the message thread and waits for its result; inline when already there — docs/plugins.md, "Built on the message thread". */
template <typename Fn>
auto onMessageThread(Fn&& fn) -> decltype(fn()) {
    if (juce::MessageManager::getInstance()->isThisTheMessageThread()) return fn();
    std::packaged_task<decltype(fn())()> task(std::forward<Fn>(fn));
    auto result = task.get_future();
    juce::MessageManager::callAsync([&task] { task(); });
    return result.get();
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

/** The orphans being kept alive, keyed by format and identifier. Never emptied — docs/plugins.md. LEAKED like the engine they were built in: releasing one at exit, after JUCE, is a crash. */
auto& orphanPlugins = *new std::unordered_map<std::string, te::Plugin::Ptr>();

// The map's own lock, held for a lookup and nothing else: the message thread takes it, and must never wait behind a plugin load (docs/audit-stabilite.md).
std::mutex orphanMapMutex;

/** Format and identifier as one map key. A newline, because neither half can contain one. */
std::string orphanKey(const std::string& formatName, const std::string& identifier) {
    return formatName + "\n" + identifier;
}

}  // namespace

te::Plugin::Ptr orphanPluginFor(const std::string& formatName, const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);
    const auto key = orphanKey(formatName, identifier);
    if (auto held = orphanPluginIfLoaded(formatName, identifier)) return held;

    // Built on the message thread: a plugin made on a worker can run its own main-thread callbacks against a half-built instance.
    bool found = false;
    auto plugin = onMessageThread([&]() -> te::Plugin::Ptr {
        auto& shared = paramQueryEngine();
        juce::PluginDescription desc;
        found = describeExternal(*shared.engine, formatName, identifier, desc);
        if (!found) return {};
        return shared.edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    });
    if (!found) {
        warn("no " + formatName + " plugin at '" + identifier + "'");
        return {};
    }
    if (plugin == nullptr) {
        warn("could not create '" + identifier + "'");
        return {};
    }
    // The same wait, and safe on the message thread too: every format this engine hosts builds its instance synchronously (AGENTS.md).
    if (!waitForParameterList(*plugin, identifier)) {
        onMessageThread([&] { plugin->deleteFromParent(); });
        warn("'" + identifier + "' did not load — a licence or an installation, not the plugin");
        return {};
    }
    {
        std::lock_guard<std::mutex> map(orphanMapMutex);
        orphanPlugins[key] = plugin;
    }
    return plugin;
}

te::Plugin::Ptr orphanPluginIfLoaded(const std::string& formatName,
                                     const std::string& identifier) {
    std::lock_guard<std::mutex> lock(orphanMapMutex);
    auto it = orphanPlugins.find(orphanKey(formatName, identifier));
    return it == orphanPlugins.end() ? te::Plugin::Ptr{} : it->second;
}

bool prepareNativePluginUI(const std::string& formatName, const std::string& identifier) {
    return orphanPluginFor(formatName, identifier) != nullptr;
}

std::optional<std::vector<PluginParamInfo>> pluginParamsOf(const std::string& formatName,
                                                           const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);

    // Built, read and dropped on the message thread, and only WAITED for here — docs/plugins.md, "Built on the message thread".
    bool found = false;
    auto plugin = onMessageThread([&]() -> te::Plugin::Ptr {
        auto& shared = paramQueryEngine();
        juce::PluginDescription desc;
        found = describeExternal(*shared.engine, formatName, identifier, desc);
        if (!found) return {};
        return shared.edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    });
    if (!found) {
        std::cerr << "[plugin-params] no " << formatName << " plugin at '" << identifier << "'\n";
        return std::nullopt;
    }
    if (plugin == nullptr) {
        std::cerr << "[plugin-params] could not create '" << identifier << "'\n";
        return std::nullopt;
    }
    // A plugin this machine cannot LOAD is `nullopt` like one it cannot find — neither is "this plugin has no parameters".
    if (!waitForParameterList(*plugin, identifier)) {
        onMessageThread([&] { plugin->deleteFromParent(); });
        return std::nullopt;
    }
    return onMessageThread([&] {
        std::vector<PluginParamInfo> out;
        // `withStates` ON, as the built-in dump has it: this runs once per ASK rather than per state frame.
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
        // Dropped before the next query: the edit outlives this call, and an instrument left on it holds voices and a binary open.
        plugin->deleteFromParent();
        return out;
    });
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
    // `loadVstPreset`, not `setStateInformation`, and the difference is the whole point of this CLI — docs/plugins.md.
    if (!loadVstPreset(*plugin, juce::File(juce::String(stateFile))))
        std::cerr << "[dump-params-ext] no state applied from '" << stateFile
                  << "' — the params below are the plugin's own defaults\n";

    const auto params = paramsJson(*plugin);
    const auto values = currentParamValues(*plugin);

    // Completeness: only if a fresh instance carrying these params reproduces the exact state. Expect `false` from big instruments — docs/plugins.md.
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
        // Handed back like every other instance here: left alone, the comparison instance sits in the cache until the Edit goes.
        plugin2->deleteFromParent();
    }
    emitParamsJson(params, complete);

    // The answer is printed; now let the message thread actually FREE the plugins, which their destructors do not — docs/plugins.md.
    plugin->deleteFromParent();
    plugin = nullptr;  // the cache's reference is gone with deleteFromParent; this drops ours
    pumpMessages(500);
    return 0;
}

int dumpSurgeLayout() {
#if STUDIO_SURGE
    std::cout << surge::SurgeCore::layoutJson() << std::endl;
    return 0;
#else
    std::cerr << "[dump-surge-layout] this engine is built without Surge XT\n";
    return 1;
#endif
}

}  // namespace studio
