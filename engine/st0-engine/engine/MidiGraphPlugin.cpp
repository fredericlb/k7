#include "MidiGraphPlugin.h"
#include "Warnings.h"

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* MidiGraphPlugin::xmlTypeName = "studio_midigraph";

// A transpose of zero, hand-written: a module naming no `jsdsp:` is an inert transposer rather than an error.
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
    // Same contract as GraphDspPlugin: read HERE, because Tracktion creates AutomatableParameters nowhere else.
    const juce::String json = state.hasProperty("graph")
                                  ? state.getProperty("graph").toString()
                                  : juce::String(defaultGraphJson());
    juce::String error;
    graph_ = DspGraph::build(juce::JSON::parse(json), error);
    if (graph_ == nullptr) {
        warn("midi graph unusable: " + error.toStdString());
        return;
    }
    // A MIDI plugin whose graph has no MIDI node is pointed at the wrong carrier; say so, and let the notes flow.
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
    sampleRate_ = info.sampleRate > 0.0 ? info.sampleRate : 44100.0;
    if (graph_) graph_->prepare(info.sampleRate, info.blockSizeSamples);
}

double MidiGraphPlugin::secondsPerBeat()
{
    // Read on the audio thread, once a block: the edit carries ONE tempo, and it is a plain number.
    // Nothing here follows a tempo sequence, because no ProjectDoc expresses one.
    double bpm = 120.0;
    if (auto* t = edit.tempoSequence.getTempo(0)) bpm = t->getBpm();
    return 60.0 / juce::jmax(1.0, bpm);
}

void MidiGraphPlugin::deinitialise() {}

void MidiGraphPlugin::midiPanic()
{
    // A graph with `mhold` in it is a note SOURCE holding keys of its own, so the panic has to reach
    // HERE and not only the instrument it feeds — DspGraph::reset() drops the held set and the clock.
    if (graph_) graph_->reset();
}

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

    // Read once, handed over as plain floats: the graph never touches Tracktion. Same rule as the audio plugin.
    for (size_t i = 0; i < params_.size(); ++i)
        scratch_[i] = params_[i]->getCurrentValue();

    const double seconds = sampleRate_ > 0.0 ? fc.bufferNumSamples / sampleRate_ : 0.0;
    graph_->processMidi(*fc.bufferForMidiMessages, scratch_.data(), (int)scratch_.size(), seconds,
                        secondsPerBeat());
}

}  // namespace studio
