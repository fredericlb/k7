#include "GraphDspPlugin.h"
#include "Warnings.h"

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* GraphDspPlugin::xmlTypeName = "studio_dspgraph";

// The Auto Wah, as data — the fallback when a module names no `dsp:`.
//
// GENERATED: this is packages/dsp/graphs/autowah.json verbatim, emitted by @studio/dsp. It is pasted rather
// than read because the engine parses no files, and autowah.test.ts compares the two so the copy cannot drift.
// Do not hand-edit — change the JS and re-run its build.
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
    // The description: the state's own `graph` property, or the built-in default. Parsed HERE because the
    // parameters it declares have to exist before the constructor returns.
    const juce::String json = state.hasProperty("graph")
                                  ? state.getProperty("graph").toString()
                                  : juce::String(defaultGraphJson());
    juce::String error;
    graph_ = DspGraph::build(juce::JSON::parse(json), error);
    if (graph_ == nullptr) {
        // A broken description leaves a plugin that passes audio through — and says why, on the channel that
        // reaches the frontend, because otherwise it is a module that looks fine and does nothing.
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

void GraphDspPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    if (graph_) graph_->prepare(info.sampleRate, info.blockSizeSamples);
}

void GraphDspPlugin::deinitialise() {}

void GraphDspPlugin::reset()
{
    if (graph_) graph_->reset();
}

void GraphDspPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    if (ctx.destBuffer == nullptr || graph_ == nullptr) return;
    for (size_t i = 0; i < params_.size(); ++i)
        scratch_[i] = params_[i]->getCurrentValue();
    graph_->process(*ctx.destBuffer, ctx.bufferStartSample, ctx.bufferNumSamples,
                    scratch_.data(), (int)scratch_.size());
}

}  // namespace studio
