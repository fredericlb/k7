// Plugin-parameter dump CLIs — see the dumpPluginParams / dumpPluginParamsExternal
// declarations in EngineHost.h. l8's text alternative to an opaque .vstpreset:
// enumerate a plugin's automatable parameters and print { params, complete } as
// sentinel-fenced JSON. `complete` means the params fully reproduce the plugin state
// (so the preset can be dropped).

#include "EngineHost.h"

#include "EngineTypes.h"     // Tracktion/JUCE + the te/tt/fs aliases
#include "PluginScan.h"      // registerBuiltInPlugins / builtInPlugins
#include "PluginParams.h"    // paramsJson / currentParamValues / applyPluginParams / pluginParams

#include <iostream>
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

    std::ostringstream out;
    out << "{";
    bool firstPlugin = true;
    for (const auto& info : builtInPlugins()) {
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

int dumpPluginParamsExternal(const std::string& formatName, const std::string& identifier,
                             const std::string& stateFile) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    auto enginePtr = makeOfflineEngine();
    auto& engine = *enginePtr;
    // Same built-ins the live host has, or this path silently renders without them.
    registerBuiltInPlugins(engine);
    auto edit = te::Edit::createSingleTrackEdit(engine);

    // Resolve a PluginDescription via its format — no plugin code runs here, only the already-scanned type info.
    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    juce::PluginDescription desc;
    bool found = false;
    for (auto* f : formats.getFormats()) {
        if (f->getName() != juce::String(formatName)) continue;
        juce::OwnedArray<juce::PluginDescription> types;
        f->findAllTypesForFile(types, juce::String(identifier));
        if (!types.isEmpty()) { desc = *types[0]; found = true; }
        break;
    }
    if (!found) {
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
