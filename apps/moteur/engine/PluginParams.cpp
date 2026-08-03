// Plugin parameter read/write as text — see PluginParams.h.

#include "PluginParams.h"
#include "Warnings.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <map>

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

// --- built-ins that register no automatable parameters ------------------------
//
// Chorus and Phaser keep their controls as CachedValue members bound to ValueTree properties rather than calling
// addParam(), and nothing enumerates those — so without this table the engine reports them as having no
// parameters at all. The defaults come from each constructor and are exact; the RANGES are ours, read off how
// applyToBuffer() consumes the value and advisory only. See docs/builtinParams.md.
struct StateParam {
    const char* property;  // the ValueTree property the CachedValue is bound to
    const char* name;      // display name, the key pistes addresses it by
    double min, max, def;
};

struct StateParamSet {
    const char* pluginType;  // Plugin::getPluginType() == xmlTypeName
    std::vector<StateParam> params;
};

const std::vector<StateParamSet>& stateParamTable() {
    static const std::vector<StateParamSet> table{
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
    return table;
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
    if (!out.empty())
        return out;

    // No registered parameters — fall back to this plugin type's authored property set. A read takes the authored
    // default when the property is absent, exactly as the plugin's own CachedValue::referTo does, so an untouched
    // plugin reports its real resting state rather than 0.
    const auto* sps = stateParamsFor(plugin);
    if (sps == nullptr)
        return out;
    for (const auto& sp : *sps) {
        const juce::Identifier id{sp.property};
        auto* state = &plugin.state;
        // Written with no UndoManager on purpose: these arrive from a knob drag at interactive rates, and one undo step
        // per frame would be useless and unbounded. The plugins re-read the value every block, so it takes effect.
        out.push_back({sp.name,
                       [state, id, def = sp.def] { return (double)state->getProperty(id, def); },
                       [state, id, lo = sp.min, hi = sp.max](double v) {
                           // Clamped, unlike an AutomatableParameter write: this goes straight into a real-time buffer calculation (a
                           // negative chorus depth inverts its sweep bounds) and the plugin does no checking of its own.
                           state->setProperty(id, juce::jlimit(lo, hi, v), nullptr);
                       },
                       sp.def,
                       sp.min,
                       sp.max});
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
