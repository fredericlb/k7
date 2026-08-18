// Plugin parameter read/write as text — see PluginParams.h.

#include "PluginParams.h"
#include "Warnings.h"

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

// --- built-in controls that are NOT automatable parameters --------------------
//
// Several Tracktion built-ins keep controls as CachedValue members bound to ValueTree properties rather than
// calling addParam(), and nothing enumerates those — so without this table the engine cannot report them. The
// defaults come from each constructor and are exact; the RANGES are ours, read off how the value is consumed
// and advisory only. See docs/builtinParams.md.
//
// It is a SUPPLEMENT, not a fallback. Chorus and Phaser register nothing at all, which is how it started; 4OSC
// registers 68 and still keeps its wave shapes here, so a plugin with both kinds has to report both. Reporting
// only the automatable half was a synth whose oscillators could be tuned and not chosen.
struct StateParam {
    // OWNED strings, not literals. 4OSC's are built per oscillator — "waveShape1".."waveShape4" — so they
    // cannot be literals, and a `const char*` into a vector of std::string dangles the moment that vector
    // grows past its reserve. It did: the four wave shapes silently vanished from the dump while the
    // hand-written entries beside them survived, which is what a reallocation looks like from outside.
    std::string property;  // the ValueTree property the CachedValue is bound to
    std::string name;      // display name, the key l8 addresses it by
    double min, max, def;
    // A DISCRETE control's settings in order, empty for a continuous one. Only where the plugin's own header
    // NAMES them: an int whose meanings are not written down anywhere gets a range and no labels, because a
    // guessed label is worse than a number — it reads as knowledge.
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

        // 4OSC. The names mirror its automatable ones — "Wave Shape 1" beside "Tune 1" — because they sit in one
        // list on screen and a widget binds by name. The per-oscillator properties are `<id><n>`, which is what
        // `oscID` builds; the defaults are each `referTo`'s, and oscillator ONE starts on a sine while the other
        // three start at none, which is exactly what makes a fresh 4OSC a single sine.
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
        // No labels on these three: `filterType`, `filterSlope` and `voiceMode` are plain ints in the header
        // with no enum naming their values. A range lets you set one; an invented label would claim to know
        // which is which. Slope's default of 12 says its unit is dB/octave, and that is as far as the source goes.
        four.push_back({"filterType", "Filter Type", 0.0, 5.0, 0.0});
        four.push_back({"filterSlope", "Filter Slope", 12.0, 24.0, 12.0});
        four.push_back({"voiceMode", "Voice Mode", 0.0, 2.0, 2.0});
        four.push_back({"voices", "Voices", 1.0, 32.0, 32.0});
        four.push_back({"ampAnalog", "Amp Analog", 0.0, 1.0, 1.0});
        // The four built-in effects' ON switches. Their depth/mix knobs ARE automatable and already listed, and
        // a knob that does nothing because the effect is off is the worst version of this list being incomplete.
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

// The named settings of an EXTERNAL plugin's parameter, read from the JUCE parameter underneath rather than
// from Tracktion's wrapper: Tracktion decides discreteness from VSTXML, a VST2-era sidecar no VST3 ships, so
// isDiscrete() is false for every VST3 parameter. JUCE's wrapper does model it, so ask it directly.
// Values are normalised, so state i sits at i/(steps-1). The parameters are keyed the way Tracktion keys its
// own — paramID, falling back to position — because ExternalAutomatableParameter is private to the module and
// can't be named here. Built ONCE per plugin: a linear search per parameter was 19k casts on a 138-param VST3.
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

// A JUCE parameter's named steps, or empty when it has none worth showing. Shared by the automatable path and
// the non-automatable one, which ask the same question of the same kind of object.
std::vector<std::pair<juce::String, double>> juceStates(juce::AudioProcessorParameter* jp) {
    if (jp == nullptr || !jp->isDiscrete())
        return {};
    const int steps = jp->getNumSteps();
    if (steps < 2 || steps > MAX_NAMED_STATES)
        return {};
    // getAllValueStrings() is the plugin's own list where it has one; otherwise ask for each step's text. A
    // parameter naming none of its steps has nothing to put in a dropdown, so it stays continuous.
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

// The parameters an EXTERNAL plugin exposes that Tracktion never wrapped. buildParameterList() keeps only
// automatable ones — most of a synth, but on an amp sim that drops exactly the controls picking the RIG: amp
// model, cabinet, IR, mic and position. They are real VST3 parameters; the plugin just declines to mark them
// automatable, usually because changing one reloads something. Named like their automatable siblings and
// appended AFTER them, so every name already bound in a song keeps meaning what it always did.
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
        // JUCE's VST3 host publishes the plugin's MIDI-mapping table as parameters — 16 channels × 130 controllers =
        // 2080 of them. A routing table, not controls, and they buried the real ones: Genome reports 31 of its own and
        // 2080 of these. Dropped by name, which is the only thing that distinguishes them.
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

// name -> current value, but ONLY where it differs from the plugin's default (params with no known default
// are kept — we can't tell): the minimal text "preset", since a fresh instance already sits at its defaults.
// Compared in each parameter's own range with a small relative tolerance. File-local: only two callers need it.
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
    // Empty unless states were asked for, so the hot path never touches the plugin's
    // parameter list at all.
    const auto byId = withStates ? juceParamsById(plugin)
                                 : std::map<juce::String, juce::AudioProcessorParameter*>{};
    for (auto& [key, param] : namedParams(plugin)) {
        const auto r = param->getValueRange();
        // A parameter is discrete when it says so AND names its settings; one with states
        // but no labels ("3 of 5") has nothing a dropdown could show, so it stays a
        // continuous control. getAllLabels() and getNumberOfStates() can disagree on an
        // external plugin whose VSTXML lists blank entries (removeEmptyStrings drops
        // them), so pair them by the SHORTER of the two rather than trusting either.
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
    // …then whatever Tracktion refused to wrap. Appended rather than interleaved so the
    // names already bound in a project keep pointing at the same parameters.
    {
        std::map<juce::String, int> seen;
        for (const auto& p : out)
            seen[p.name] = 1;
        for (auto& extra : nonAutomatableParams(plugin, seen, withStates))
            out.push_back(std::move(extra));
    }
    // …then this plugin type's authored property set. APPENDED, not a fallback: 4OSC registers 68 automatable
    // parameters and still keeps its wave shapes on the ValueTree, so a plugin with both kinds must report both.
    // Guarded by name, so an entry that duplicates a registered one never shadows it. A read takes the authored
    // default when the property is absent, exactly as the plugin's own CachedValue::referTo does, so an untouched
    // plugin reports its real resting state rather than 0.
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
        // Written with no UndoManager on purpose: these arrive from a knob drag at interactive rates, and one undo step
        // per frame would be useless and unbounded. The plugins re-read the value every block, so it takes effect.
        out.push_back({name,
                       [state, id, def = sp.def] { return (double)state->getProperty(id, def); },
                       [state, id, lo = sp.min, hi = sp.max](double v) {
                           // Clamped, unlike an AutomatableParameter write: this goes straight into a real-time buffer calculation (a
                           // negative chorus depth inverts its sweep bounds) and the plugin does no checking of its own.
                           state->setProperty(id, juce::jlimit(lo, hi, v), nullptr);
                       },
                       sp.def,
                       sp.min,
                       sp.max,
                       // The settings, when the plugin's header names them — what makes a wave shape a
                       // dropdown rather than a knob sweeping 0..6 through six things with no order.
                       // Under `withStates` like every other source of them, so the 20 Hz path stays free.
                       withStates ? states(sp) : std::vector<std::pair<juce::String, double>>{}});
    }
    return out;
}

std::vector<std::pair<std::string, double>> allParams(te::Plugin& plugin) {
    std::vector<std::pair<std::string, double>> out;
    for (const auto& p : pluginParams(plugin))
        out.emplace_back(p.name.toStdString(), p.get());
    return out;
}

void applyPluginParams(te::Plugin& plugin, const std::unordered_map<std::string, double>& params) {
    if (params.empty())
        return;
    std::map<std::string, std::function<void(double)>> byName;
    for (auto& p : pluginParams(plugin))
        byName[p.name.toStdString()] = p.set;
    for (const auto& [name, value] : params) {
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
