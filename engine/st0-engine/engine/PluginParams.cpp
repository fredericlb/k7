// Plugin parameter read/write as text — see PluginParams.h.

#include "PluginParams.h"
#include "Warnings.h"
#include "MixBlend.h"   // a module's @mix, set here beside its params

#include <algorithm>
#include <cmath>
#include <iostream>
#include <map>
#include <set>
#include <string>
#include <utility>

namespace studio {

std::vector<std::pair<juce::String, te::AutomatableParameter*>> namedParams(te::Plugin& plugin) {
    std::vector<std::pair<juce::String, te::AutomatableParameter*>> out;
    std::map<juce::String, int> seen;
    for (int i = 0; i < plugin.getNumAutomatableParameters(); ++i)
        if (auto param = plugin.getAutomatableParameter(i)) {
            juce::String name = param->getParameterName();
            if (name.isEmpty())
                name = param->paramID;
            const int n = ++seen[name];
            out.push_back({n == 1 ? name : name + " #" + juce::String(n), param.get()});
        }
    return out;
}

namespace {

// Built-in controls that are NOT automatable parameters — a SUPPLEMENT to the generic walk, never a fallback. See docs/builtinParams.md.
struct StateParam {
    // OWNED strings, not literals: 4OSC's are built per oscillator, and a `const char*` into a growing vector dangles (docs/builtinParams.md).
    std::string property;  // the ValueTree property the CachedValue is bound to
    std::string name;      // display name, the key st0 addresses it by
    double min, max, def;
    // A DISCRETE control's settings in order, only where the plugin's own header NAMES them — a guessed label reads as knowledge.
    std::vector<std::pair<const char*, double>> states{};
};

struct StateParamSet {
    const char* pluginType;  // Plugin::getPluginType() == xmlTypeName
    std::vector<StateParam> params;
};

// FourOscPlugin::WaveShape, in its own order. `none` is a real setting — it is how an oscillator is switched off.
const std::vector<std::pair<const char*, double>>& waveShapes() {
    static const std::vector<std::pair<const char*, double>> v{
        {"None", 0}, {"Sine", 1}, {"Triangle", 2}, {"Saw up", 3},
        {"Saw down", 4}, {"Square", 5}, {"Random", 6}};
    return v;
}

const std::vector<StateParamSet>& stateParamTable() {
    static const std::vector<StateParamSet> table = [] {
        std::vector<StateParamSet> t{
            {"chorus",
             {{"depthMs", "Depth", 0.0, 20.0, 3.0},
              {"speedHz", "Speed", 0.0, 10.0, 1.0},
              {"width", "Width", 0.0, 1.0, 0.5},
              {"mixProportion", "Mix", 0.0, 1.0, 0.5}}},
            {"phaser",
             {{"depth", "Depth", 0.0, 10.0, 5.0},
              {"rate", "Rate", 0.0, 10.0, 0.4},
              {"feedback", "Feedback", 0.0, 1.0, 0.7}}},
        };

        // 4OSC. Names mirror its automatable ones so both sit in one list; properties are `<id><n>`, and the defaults are each `referTo`'s.
        std::vector<StateParam> four;
        for (int n = 1; n <= 4; ++n) {
            const auto s = std::to_string(n);
            four.push_back({"waveShape" + s, "Wave Shape " + s, 0.0, 6.0,
                            n == 1 ? 1.0 : 0.0, waveShapes()});
            four.push_back({"voices" + s, "Voices " + s, 1.0, 8.0, 1.0});
        }
        for (int n = 1; n <= 2; ++n) {
            const auto s = std::to_string(n);
            four.push_back({"lfoWaveShape" + s, "LFO Shape " + s, 0.0, 6.0,
                            n == 1 ? 1.0 : 0.0, waveShapes()});
        }
        // These three have no ENUM and are named all the same, read off the code that consumes them — docs/builtinParams.md.
        four.push_back({"filterType", "Filter Type", 0.0, 4.0, 0.0,
                        {{"Off", 0}, {"Low-pass", 1}, {"High-pass", 2},
                         {"Band-pass", 3}, {"Notch", 4}}});
        // Two poles or four: `filterSlopeValue == 24` is the test that cascades the second pair.
        four.push_back({"filterSlope", "Filter Slope", 12.0, 24.0, 12.0,
                        {{"12 dB/oct", 12}, {"24 dB/oct", 24}}});
        four.push_back({"voiceMode", "Voice Mode", 0.0, 2.0, 2.0,
                        {{"Mono", 0}, {"Legato", 1}, {"Poly", 2}}});
        // How many notes at once, and only in Poly: the other two modes reduce the pool to 1 whatever this says.
        four.push_back({"voices", "Voices", 1.0, 32.0, 32.0});
        four.push_back({"ampAnalog", "Amp Analog", 0.0, 1.0, 1.0});
        // The four built-in effects' ON switches — their depth/mix knobs are automatable, and a dead knob is the worst version of a gap here.
        four.push_back({"distortionOn", "Distortion On", 0.0, 1.0, 0.0});
        four.push_back({"reverbOn", "Reverb On", 0.0, 1.0, 0.0});
        four.push_back({"delayOn", "Delay On", 0.0, 1.0, 0.0});
        four.push_back({"chorusOn", "Chorus On", 0.0, 1.0, 0.0});
        // The delay TIME, whose three companions (feedback, crossfeed, mix) are automatable and this is not.
        four.push_back({"delay", "Delay", 0.0, 4.0, 1.0});
        t.push_back({"4osc", std::move(four)});
        return t;
    }();
    return table;
}

/** A state param's settings in the shape a ParamRef carries them — `const char*` labels become juce::Strings. */
std::vector<std::pair<juce::String, double>> states(const StateParam& sp) {
    std::vector<std::pair<juce::String, double>> out;
    out.reserve(sp.states.size());
    for (const auto& [label, value] : sp.states)
        out.emplace_back(juce::String(label), value);
    return out;
}

const std::vector<StateParam>* stateParamsFor(te::Plugin& plugin) {
    const auto type = plugin.getPluginType();
    for (const auto& e : stateParamTable())
        if (type == e.pluginType)
            return &e.params;
    return nullptr;
}

// A dropdown of hundreds of entries is a list, not a control, and some plugins report one step per program.
constexpr int MAX_NAMED_STATES = 64;

// An external plugin's parameters keyed as Tracktion keys its own, built ONCE — discreteness comes from JUCE, not Tracktion (docs/plugins.md).
std::map<juce::String, juce::AudioProcessorParameter*> juceParamsById(te::Plugin& plugin) {
    std::map<juce::String, juce::AudioProcessorParameter*> out;
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    if (ext == nullptr)
        return out;
    auto* inst = ext->getAudioPluginInstance();
    if (inst == nullptr)
        return out;
    const auto& all = inst->getParameters();
    for (int i = 0; i < all.size(); ++i) {
        juce::String id{i};
        if (auto* withId = dynamic_cast<juce::AudioProcessorParameterWithID*>(all[i]))
            id = withId->paramID;
        out.emplace(id, all[i]);
    }
    return out;
}

// A JUCE parameter's named steps, or empty when it has none worth showing — shared by the automatable and non-automatable paths.
std::vector<std::pair<juce::String, double>> juceStates(juce::AudioProcessorParameter* jp) {
    if (jp == nullptr || !jp->isDiscrete())
        return {};
    const int steps = jp->getNumSteps();
    if (steps < 2 || steps > MAX_NAMED_STATES)
        return {};
    // getAllValueStrings() where the plugin has one, else each step's text; a parameter naming none of its steps stays continuous.
    const auto all = jp->getAllValueStrings();
    std::vector<std::pair<juce::String, double>> out;
    for (int i = 0; i < steps; ++i) {
        const double v = (double)i / (double)(steps - 1);
        juce::String label = i < all.size() ? all[i] : jp->getText((float)v, 64);
        if (label.isEmpty())
            return {};
        out.emplace_back(label, v);
    }
    return out;
}

std::vector<std::pair<juce::String, double>> externalStates(
    const std::map<juce::String, juce::AudioProcessorParameter*>& byId,
    te::AutomatableParameter* param) {
    const auto it = byId.find(param->paramID);
    if (it == byId.end())
        return {};
    return juceStates(it->second);
}

// The parameters an EXTERNAL plugin exposes that Tracktion never wrapped, appended AFTER the automatable ones — docs/plugins.md.
std::vector<ParamRef> nonAutomatableParams(te::Plugin& plugin,
                                           std::map<juce::String, int>& seen,
                                           bool withStates) {
    std::vector<ParamRef> out;
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    if (ext == nullptr)
        return out;
    auto* inst = ext->getAudioPluginInstance();
    if (inst == nullptr)
        return out;
    for (auto* p : inst->getParameters()) {
        if (p == nullptr || p->isAutomatable())
            continue;  // the automatable ones are already in the list
        juce::String name = p->getName(1024);
        if (name.isEmpty())
            continue;  // nothing a module could bind to
        // JUCE publishes the plugin's MIDI-mapping table as 2080 parameters, dropped by name — the only thing that distinguishes them.
        if (name.startsWith("MIDI CC "))
            continue;
        const int n = ++seen[name];
        if (n > 1)
            name = name + " #" + juce::String(n);
        // JUCE parameter values are normalised 0..1, the convention an external plugin's automatable ones already use.
        out.push_back({name,
                       [p] { return (double)p->getValue(); },
                       [p](double v) {
                           p->setValueNotifyingHost((float)juce::jlimit(0.0, 1.0, v));
                       },
                       (double)p->getDefaultValue(),
                       0.0,
                       1.0,
                       withStates ? juceStates(p) : std::vector<std::pair<juce::String, double>>{}});
    }
    return out;
}

// name -> current value, ONLY where it differs from the default — the minimal text "preset", compared with a small relative tolerance.
std::vector<std::pair<std::string, double>> changedParams(te::Plugin& plugin) {
    std::vector<std::pair<std::string, double>> out;
    for (const auto& p : pluginParams(plugin)) {
        const double cur = p.get();
        bool differs = true;
        if (p.def.has_value()) {
            const double d = *p.def;
            differs = std::abs(cur - d) > 1.0e-6 * std::max(1.0, std::abs(d));
        }
        if (differs)
            out.emplace_back(p.name.toStdString(), cur);
    }
    return out;
}

}  // namespace

std::vector<ParamRef> pluginParams(te::Plugin& plugin, bool withStates) {
    std::vector<ParamRef> out;
    // Empty unless states were asked for, so the hot path never touches the plugin's parameter list at all.
    const auto byId = withStates ? juceParamsById(plugin)
                                 : std::map<juce::String, juce::AudioProcessorParameter*>{};
    for (auto& [key, param] : namedParams(plugin)) {
        const auto r = param->getValueRange();
        // Discrete only when it says so AND names its settings; labels and state count can disagree, so pair them by the SHORTER.
        std::vector<std::pair<juce::String, double>> states;
        if (withStates) {
            if (param->isDiscrete() && param->hasLabels()) {
                const auto labels = param->getAllLabels();
                const int n = std::min(labels.size(), param->getNumberOfStates());
                for (int i = 0; i < n; ++i)
                    states.emplace_back(labels[i], (double)param->getValueForState(i));
            }
            // Tracktion knows about VST2 value types only; a VST3's steps come from JUCE.
            if (states.empty())
                states = externalStates(byId, param);
        }
        out.push_back({key,
                       [param] { return (double)param->getCurrentValue(); },
                       [param](double v) {
                           param->setParameter((float)v, juce::dontSendNotification);
                       },
                       [param]() -> std::optional<double> {
                           const auto d = param->getDefaultValue();
                           return d.has_value() ? std::optional<double>((double)*d) : std::nullopt;
                       }(),
                       (double)r.getStart(),
                       (double)r.getEnd(),
                       std::move(states)});
    }
    // …then whatever Tracktion refused to wrap, appended rather than interleaved so bound names keep pointing at the same parameters.
    {
        std::map<juce::String, int> seen;
        for (const auto& p : out)
            seen[p.name] = 1;
        for (auto& extra : nonAutomatableParams(plugin, seen, withStates)) {
            extra.automatable = false;
            out.push_back(std::move(extra));
        }
    }
    // …then this plugin type's authored property set, APPENDED and guarded by name rather than a fallback — docs/builtinParams.md.
    const auto* sps = stateParamsFor(plugin);
    if (sps == nullptr)
        return out;
    std::set<juce::String> already;
    for (const auto& p : out)
        already.insert(p.name);
    for (const auto& sp : *sps) {
        const juce::String name{sp.name};
        if (already.count(name) != 0)
            continue;
        const juce::Identifier id{juce::String(sp.property)};
        auto* state = &plugin.state;
        // No UndoManager on purpose: these arrive from a knob drag at interactive rates, and the plugins re-read the value every block.
        out.push_back({name,
                       [state, id, def = sp.def] { return (double)state->getProperty(id, def); },
                       [state, id, lo = sp.min, hi = sp.max](double v) {
                           // Clamped, unlike an AutomatableParameter write: this feeds a real-time buffer calculation and the plugin checks nothing.
                           state->setProperty(id, juce::jlimit(lo, hi, v), nullptr);
                       },
                       sp.def,
                       sp.min,
                       sp.max,
                       // The settings, when the plugin's header names them — under `withStates` like every other source, so the 20 Hz path stays free.
                       withStates ? states(sp) : std::vector<std::pair<juce::String, double>>{}});
        out.back().automatable = false;
    }
    return out;
}

std::vector<std::pair<std::string, double>> allParams(te::Plugin& plugin) {
    std::vector<std::pair<std::string, double>> out;
    for (const auto& p : pluginParams(plugin))
        out.emplace_back(p.name.toStdString(), p.get());
    // A module with a stage reports its three values beside its own params, so its knobs follow the engine.
    for (auto& [name, value] : stageParams(plugin)) out.emplace_back(name, value);
    return out;
}

void applyPluginParams(te::Plugin& plugin, const std::unordered_map<std::string, double>& params) {
    if (params.empty())
        return;
    std::map<std::string, std::function<void(double)>> byName;
    for (auto& p : pluginParams(plugin))
        byName[p.name.toStdString()] = p.set;
    for (const auto& [name, value] : params) {
        // The ENGINE's blend around the module, not one of the plugin's params — docs/mix.md.
        // The engine's own stage around the module, not the plugin's params; each one arriving at all holds what it replaces — docs/mix.md.
        if (name == kMixParam) {
            holdOwnMix(plugin);
            setModuleMix(plugin, value);
            continue;
        }
        if (name == kInputVolumeParam) {
            holdOwnLevel(plugin, 1);
            setModuleInputDb(plugin, value);
            continue;
        }
        if (name == kOutputVolumeParam) {
            holdOwnLevel(plugin, -1);
            setModuleOutputDb(plugin, value);
            continue;
        }
        const auto it = byName.find(name);
        if (it != byName.end())
            it->second(value);
        else
            warn("plugin '" + plugin.getName().toStdString() + "' has no parameter named '" + name + "'");
    }
}

juce::String paramsJson(te::Plugin& plugin) {
    juce::String s = "{";
    bool first = true;
    for (const auto& [name, value] : changedParams(plugin)) {
        s << (first ? "" : ",") << juce::JSON::toString(juce::var(juce::String(name))) << ":"
          << juce::JSON::toString(juce::var(value));
        first = false;
    }
    return s + "}";
}

std::unordered_map<std::string, double> currentParamValues(te::Plugin& plugin) {
    std::unordered_map<std::string, double> m;
    for (const auto& [name, value] : changedParams(plugin))
        m[name] = value;
    return m;
}

}  // namespace studio
