// NamPlugin.h — a neural amp as a Tracktion built-in: it loads a model (a .nam, or an AIDA-X / Proteus JSON run by
// RTNeural — AmpModel.h) and runs its inference, the NON-LINEAR half of a guitar rig an IR cannot be.
// MONO, since every such model is one-in/one-out. A model runs at the rate it was TRAINED at, resampled
// either side when the engine runs at another (eurorack's RateBridge), and reports that latency. docs/namPlugin.md.

#pragma once

// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include <atomic>
#include <memory>
#include <optional>
#include <string>

#include "AmpModel.h"
#include "eurorack/RateBridge.h"

namespace studio {

class NamPlugin : public tracktion::engine::Plugin, private eurorack::RateBridge::Core {
public:
    explicit NamPlugin(tracktion::engine::PluginCreationInfo info);
    ~NamPlugin() override;

    static const char* getPluginName() { return "Neural Amp Modeler"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override { return "Neural Amp Modeler"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "NAM"; }
    juce::String getSelectableDescription() override { return "Neural Amp Modeler"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    // An amp has a tail: the model is recurrent and rings on, so saying otherwise cuts the note at its last sample.
    bool noTail() override { return false; }

    int getNumOutputChannelsGivenInputs(int numInputChannels) override
    {
        return juce::jmin(numInputChannels, 2);
    }

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override;
    // The converters' delay when the model runs at another rate, so the graph can line the lane up.
    double getLatencySeconds() override;

    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    // --- level --- ours arrives 6.6 dB down, which reads as "the amp does nothing" (docs/namPlugin.md)

    tracktion::engine::AutomatableParameter::Ptr inputDb, outputDb, normalize;
    juce::CachedValue<float> inputDbValue, outputDbValue, normalizeValue;

    // --- knobs --- the inputs a conditioned model was trained with besides the sound; ignored by the rest

    tracktion::engine::AutomatableParameter::Ptr knob[AmpModel::MAX_KNOBS];
    juce::CachedValue<float> knobValue[AmpModel::MAX_KNOBS];

    // The loudness the model declares, or nothing — and then `Normalize` has nothing to work from (EditBuilder warns).
    std::optional<double> modelLoudness() const;

    // What `Normalize` aims for, in dB: the figure the official NAM plugin uses, since models are shared.
    static constexpr double targetLoudnessDb = -18.0;

    // --- model ---------------------------------------------------------------

    // Load `file` and swap it in — MESSAGE thread only, since parsing a model allocates and reads JSON off disk.
    bool loadModel(const juce::File& file, juce::String& error);

    // The model's own sample rate, or 0 when it declares none — the rate it is RUN at, whatever the engine's.
    double modelSampleRate() const { return modelRate_.load(std::memory_order_relaxed); }

    /** The model file currently loaded (empty when none). */
    juce::String modelPath() const;

    // Whether the loaded model is a .nam — the only kind that declares a loudness for `Normalize`.
    bool modelIsNam() const;

    // How many `Knob n` params the loaded model reads.
    int modelKnobs() const { return modelKnobs_.load(std::memory_order_relaxed); }

    // --- cabinet -------------------------------------------------------------

    // The IR convolved AFTER the model — the cabinet a model without one needs. MESSAGE thread; JUCE loads it off it.
    bool loadImpulseResponse(const juce::File& file, juce::String& error);

private:
    // The loaded model, swapped under `lock_` — which the audio thread only ever TRIES, since blocking is a dropout.
    juce::SpinLock lock_;
    std::unique_ptr<AmpModel> dsp_;
    juce::String path_;
    std::atomic<double> modelRate_{0.0};
    std::atomic<int> modelKnobs_{0};

    // Read on the audio thread, written by loadModel — hence atomics, and two of them rather than an optional.
    std::atomic<double> loudnessDb_{0.0};
    std::atomic<bool> hasLoudness_{false};

    // The gains the last block ENDED on, so every block ramps from there rather than jumping and clicking.
    float lastInGain_ = 1.0f;
    float lastOutGain_ = 1.0f;

    // The rate and block size last prepared with, so a model loaded AFTER initialise() gets the right shape.
    double sampleRate_ = 44100.0;
    int blockSize_ = 512;

    // The mono buffer the model reads and writes, sized in initialise() and on load, NEVER in applyToBuffer.
    juce::AudioBuffer<float> mono_;

    // The cabinet: resampled to the engine's rate by JUCE itself, and skipped whole until an IR is loaded.
    juce::dsp::Convolution cab_;
    std::atomic<bool> hasIr_{false};

    // The engine's rate → the model's, one fixed block at a time, and back; idle when the two agree.
    eurorack::RateBridge bridge_;
    std::atomic<bool> bridged_{false};
    // Re-prepared on the MESSAGE thread whenever the host's rate or the model's changes, under `lock_`.
    void prepareBridge();
    // Whether a model at `model` Hz runs through the bridge at the engine's current rate.
    bool needsBridge(double model) const;
    void logBridge(double model) const;
    // One block at the model's rate: what the bridge calls, on the audio thread.
    void renderBlock(const float* const* in, float* const* out) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(NamPlugin)
};

}  // namespace studio
