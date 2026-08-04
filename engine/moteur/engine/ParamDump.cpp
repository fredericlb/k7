// Plugin-parameter dump CLIs — see the dumpPluginParams / dumpPluginParamsExternal
// declarations in EngineHost.h. l8's text alternative to an opaque .vstpreset:
// enumerate a plugin's automatable parameters and print { params, complete } as
// sentinel-fenced JSON. `complete` means the params fully reproduce the plugin state
// (so the preset can be dropped).

#include "EngineHost.h"

#include "EngineTypes.h"     // Tracktion/JUCE + the te/tt/fs aliases
#include "PluginScan.h"      // registerBuiltInPlugins
#include "PluginParams.h"    // paramsJson / currentParamValues / applyPluginParams

#include <iostream>
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

}  // namespace

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
