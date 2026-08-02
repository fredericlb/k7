#include "MidiGraphPlugin.h"
#include "Warnings.h"

namespace lanes {

namespace te = tracktion::engine;

const char* MidiGraphPlugin::xmlTypeName = "lanes_midigraph";

// A transpose of zero: the plugin still declares its parameter, so a module that names no `jsdsp:` is a working
// (if inert) transposer rather than an error. Deliberately hand-written and tiny, unlike GraphDspPlugin's
// generated auto-wah — there is nothing here worth generating.
const char* MidiGraphPlugin::defaultGraphJson()
{
    return R"({
  "params": [ { "name": "Semitones", "min": -24, "max": 24, "default": 0 } ],
  "nodes":  [ { "type": "transpose", "in": ["Semitones"] } ]
})";
}

MidiGraphPlugin::MidiGraphPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    // Same contract as GraphDspPlugin: the description is read HERE because Tracktion plugins create their
    // AutomatableParameters in the constructor and never after.
    const juce::String json = state.hasProperty("graph")
                                  ? state.getProperty("graph").toString()
                                  : juce::String(defaultGraphJson());
    juce::String error;
    graph_ = DspGraph::build(juce::JSON::parse(json), error);
    if (graph_ == nullptr) {
        warn("midi graph unusable: " + error.toStdString());
        return;
    }
    // A graph with no MIDI node in a MIDI plugin is a module pointed at the wrong carrier — it would pass notes
    // through in silence and look like a broken transposer. Say so; the notes still flow.
    if (!graph_->hasMidi())
        warn("midi graph declares no MIDI node — this module transforms nothing");

    auto* um = getUndoManager();
    for (const auto& p : graph_->params()) {
        const juce::String name(p.name);
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier("p_" + name), um, p.def);

        te::AutomatableParameter::Ptr param;
        if (p.labels.size() >= 2) {
            juce::StringArray labels;
            for (const auto& l : p.labels) labels.add(juce::String(l));
            param = new te::DiscreteLabelledParameter(name.toLowerCase(), name, *this, {p.min, p.max},
                                                      labels.size(), labels);
            addAutomatableParameter(param);
        } else {
            param = addParam(name.toLowerCase(), name, {p.min, p.max});
        }
        param->attachToCurrentValue(*value);
        params_.push_back(param);
        values_.push_back(std::move(value));
    }
    scratch_.assign(params_.size(), 0.0f);
}

MidiGraphPlugin::~MidiGraphPlugin()
{
    notifyListenersOfDeletion();
    for (auto& p : params_) p->detachFromCurrentValue();
}

juce::ValueTree MidiGraphPlugin::create()
{
    juce::ValueTree v(te::IDs::PLUGIN);
    v.setProperty(te::IDs::type, xmlTypeName, nullptr);
    return v;
}

void MidiGraphPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    if (graph_) graph_->prepare(info.sampleRate, info.blockSizeSamples);
}

void MidiGraphPlugin::deinitialise() {}

void MidiGraphPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

void MidiGraphPlugin::applyToBuffer(const te::PluginRenderContext& fc)
{
    if (graph_ == nullptr || fc.bufferForMidiMessages == nullptr) return;

    // Parameter values are read once here, off the message thread's objects, and handed over as plain floats —
    // the graph never touches Tracktion. Same rule as the audio plugin.
    for (size_t i = 0; i < params_.size(); ++i)
        scratch_[i] = params_[i]->getCurrentValue();

    graph_->processMidi(*fc.bufferForMidiMessages, scratch_.data(), (int)scratch_.size());
}

}  // namespace lanes
