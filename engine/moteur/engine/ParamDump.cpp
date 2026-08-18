// Plugin-parameter dump CLIs — see the dumpPluginParams / dumpPluginParamsExternal
// declarations in EngineHost.h. l8's text alternative to an opaque .vstpreset:
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

#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
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
 * The PluginDescription a format and an identifier name, or false.
 *
 * No plugin CODE runs here — `findAllTypesForFile` reads the already-scanned type info off the
 * binary. Factored out because two callers resolve the same way and only one of them then wants
 * the plugin's state: the param query below simply creates it and asks what it has.
 */
bool describeExternal(const std::string& formatName, const std::string& identifier,
                      juce::PluginDescription& desc) {
    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    for (auto* f : formats.getFormats()) {
        if (f->getName() != juce::String(formatName)) continue;
        juce::OwnedArray<juce::PluginDescription> types;
        f->findAllTypesForFile(types, juce::String(identifier));
        if (!types.isEmpty()) {
            desc = *types[0];
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
 * ONE PER PROCESS, not one per question, and that difference is the whole of this. Each query
 * used to build a `te::Engine` of its own and destroy it on the way out; forty of those in a
 * row killed the engine, twice, measured on a pass that drew a panel for every module in a
 * library of two hundred and sixty. Nothing in Tracktion promises that constructing and tearing
 * down whole engines beside a live one is safe, and it is not.
 *
 * That ONE engine can host every plugin in turn is not a hope: `dumpBuiltinParams` above creates
 * two hundred and twelve of them in a single edit, one at a time, and always has. This is the
 * same shape with the engine kept alive between calls — so a batch is also far cheaper than it
 * was, since building the engine was most of what each query cost.
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

}  // namespace

std::optional<std::vector<PluginParamInfo>> pluginParamsOf(const std::string& formatName,
                                                           const std::string& identifier) {
    std::lock_guard<std::mutex> lock(paramQueryMutex);
    auto& shared = paramQueryEngine();

    juce::PluginDescription desc;
    if (!describeExternal(formatName, identifier, desc)) {
        std::cerr << "[plugin-params] no " << formatName << " plugin at '" << identifier << "'\n";
        return std::nullopt;
    }
    auto plugin =
        shared.edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    if (plugin == nullptr) {
        std::cerr << "[plugin-params] could not create '" << identifier << "'\n";
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
    if (!describeExternal(formatName, identifier, desc)) {
        std::cerr << "[dump-params-ext] no " << formatName << " plugin at '" << identifier << "'\n";
        emitParamsJson("{}", false);
        return 2;
    }

    // Instantiate the external plugin and restore its state from the .vstpreset bytes. A .vstpreset is a Steinberg
    // container: if setStateInformation() rejects it, parse via Steinberg::Vst::PresetFile and feed the chunks.
    auto plugin = edit->getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
    auto* ext = dynamic_cast<te::ExternalPlugin*>(plugin.get());
    if (ext == nullptr) {
        std::cerr << "[dump-params-ext] could not create external plugin\n";
        emitParamsJson("{}", false);
        return 2;
    }
    juce::MemoryBlock state;
    if (juce::File(juce::String(stateFile)).loadFileAsData(state))
        if (auto* inst = ext->getAudioPluginInstance())
            inst->setStateInformation(state.getData(), (int)state.getSize());

    const auto params = paramsJson(*plugin);
    const auto values = currentParamValues(*plugin);

    // Completeness: a fresh instance carrying only these params must reproduce the exact state. Only then is
    // dropping the opaque preset lossless.
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
    }
    emitParamsJson(params, complete);
    return 0;
}

}  // namespace studio
