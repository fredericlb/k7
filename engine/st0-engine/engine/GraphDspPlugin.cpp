#include "GraphDspPlugin.h"
#include "Warnings.h"

#include <cmath>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* GraphDspPlugin::xmlTypeName = "studio_dspgraph";

// GENERATED — packages/dsp/graphs/autowah.json verbatim, so change the JS, never this (docs/dspGraph.md).
const char* GraphDspPlugin::defaultGraphJson()
{
    return R"({
  "params": [
    {
      "name": "Low",
      "min": 60,
      "max": 8000,
      "default": 200
    },
    {
      "name": "High",
      "min": 60,
      "max": 8000,
      "default": 2400
    },
    {
      "name": "Sensitivity",
      "min": 0,
      "max": 1,
      "default": 0.5
    },
    {
      "name": "Resonance",
      "min": 0.5,
      "max": 20,
      "default": 4
    },
    {
      "name": "Attack",
      "min": 0.1,
      "max": 200,
      "default": 8
    },
    {
      "name": "Release",
      "min": 1,
      "max": 1000,
      "default": 120
    },
    {
      "name": "Mix",
      "min": 0,
      "max": 1,
      "default": 1
    },
    {
      "name": "Direction",
      "min": 0,
      "max": 1,
      "default": 0,
      "labels": [
        "up",
        "down"
      ]
    }
  ],
  "nodes": [
    {
      "type": "envelope",
      "in": [
        "Attack",
        "Release"
      ],
      "out": "n0"
    },
    {
      "type": "todb",
      "in": [
        "n0"
      ],
      "out": "n1"
    },
    {
      "type": "lerp",
      "in": [
        -60,
        -15,
        "Sensitivity"
      ],
      "out": "n2"
    },
    {
      "type": "linmap",
      "in": [
        "n1",
        "n2",
        0
      ],
      "out": "n3"
    },
    {
      "type": "sub",
      "in": [
        1,
        "n3"
      ],
      "out": "n4"
    },
    {
      "type": "select",
      "in": [
        "n3",
        "n4",
        "Direction"
      ],
      "out": "n5"
    },
    {
      "type": "geolerp",
      "in": [
        "Low",
        "High",
        "n5"
      ],
      "out": "n6"
    },
    {
      "type": "mul",
      "in": [
        "sr",
        0.45
      ],
      "out": "n7"
    },
    {
      "type": "clamp",
      "in": [
        "n6",
        60,
        "n7"
      ],
      "out": "n8"
    },
    {
      "type": "glide",
      "in": [
        "n8"
      ],
      "out": "n9"
    },
    {
      "type": "biquad",
      "in": [
        "n9",
        "Resonance"
      ],
      "mode": "bandpass"
    },
    {
      "type": "mix",
      "in": [
        "Mix"
      ]
    }
  ]
}
)";
}

juce::ValueTree GraphDspPlugin::create()
{
    juce::ValueTree v(te::IDs::PLUGIN);
    v.setProperty(te::IDs::type, xmlTypeName, nullptr);
    return v;
}

GraphDspPlugin::GraphDspPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    // The state's own `graph`, or the default — parsed HERE because the parameters it declares must exist now.
    const juce::String json = state.hasProperty("graph")
                                  ? state.getProperty("graph").toString()
                                  : juce::String(defaultGraphJson());
    juce::String error;
    graph_ = DspGraph::build(juce::JSON::parse(json), error);
    if (graph_ == nullptr) {
        // A broken description passes audio through, and SAYS why: otherwise it looks fine and does nothing.
        warn("dsp graph unusable: " + error.toStdString());
        return;
    }

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

GraphDspPlugin::~GraphDspPlugin()
{
    notifyListenersOfDeletion();
    for (auto& p : params_)
        p->detachFromCurrentValue();
}

void GraphDspPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

// The plugin's jacks: a PAIR per port, at channels 2n / 2n+1, where Tracktion's own routing puts one (docs/sidechain.md).
void GraphDspPlugin::getChannelNames(juce::StringArray* ins, juce::StringArray* outs)
{
    te::Plugin::getChannelNames(ins, outs);   // left/right, the pair every plugin has
    if (ins == nullptr || graph_ == nullptr) return;
    for (int p = 1; p < graph_->inputs(); ++p) {
        ins->add("Input " + juce::String(p + 1) + " L");
        ins->add("Input " + juce::String(p + 1) + " R");
    }
}

// Stated rather than left to the channel count: a module is sidechainable exactly when its graph has a port 1.
bool GraphDspPlugin::canSidechain()
{
    return !isInRack() && graph_ != nullptr && graph_->inputs() > 1;
}

void GraphDspPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    if (graph_) graph_->prepare(info.sampleRate, info.blockSizeSamples);
}

void GraphDspPlugin::deinitialise() {}

void GraphDspPlugin::reset()
{
    resetPending_ = true;
}

void GraphDspPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    // Flush denormals: a decaying feedback delay is the canonical way to make an engine slow down (docs/dspGraph.md).
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr || graph_ == nullptr) return;
    if (resetPending_.exchange(false)) graph_->reset();
    for (size_t i = 0; i < params_.size(); ++i)
        scratch_[i] = params_[i]->getCurrentValue();
    graph_->process(*ctx.destBuffer, ctx.bufferStartSample, ctx.bufferNumSamples,
                    scratch_.data(), (int)scratch_.size());

    // A feedback loop with no saturator can run its state to Inf, which never decays: silenced here and the graph cleared next block, as Faust's is.
    bool poisoned = false;
    for (int c = 0; c < ctx.destBuffer->getNumChannels(); ++c) {
        float* v = ctx.destBuffer->getWritePointer(c, ctx.bufferStartSample);
        for (int i = 0; i < ctx.bufferNumSamples; ++i)
            if (!std::isfinite(v[i])) { v[i] = 0.0f; poisoned = true; }
    }
    if (poisoned) resetPending_ = true;
}

}  // namespace studio
