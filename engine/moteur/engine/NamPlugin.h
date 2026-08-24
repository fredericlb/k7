// NamPlugin.h — a Neural Amp Modeler as a Tracktion built-in: it loads a .nam model and runs its inference,
// giving the NON-LINEAR half of a guitar rig that convolution cannot (an IR is the cabinet, never the amp).
// MONO, since every NAM model is one-in/one-out. See docs/namPlugin.md.

#pragma once

// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include <atomic>
#include <memory>
#include <optional>
#include <string>

// NAM_SAMPLE is `float` for us, so the model reads JUCE's buffers with no convert out and back per block.
#include <NAM/dsp.h>

namespace studio {

class NamPlugin : public tracktion::engine::Plugin {
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

    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    // --- level --- ours arrives 6.6 dB down, which reads as "the amp does nothing" (docs/namPlugin.md)

    tracktion::engine::AutomatableParameter::Ptr inputDb, outputDb, normalize;
    juce::CachedValue<float> inputDbValue, outputDbValue, normalizeValue;

    // The loudness the model declares, or nothing — and then `Normalize` has nothing to work from (EditBuilder warns).
    std::optional<double> modelLoudness() const;

    // What `Normalize` aims for, in dB: the figure the official NAM plugin uses, since models are shared.
    static constexpr double targetLoudnessDb = -18.0;

    // --- model ---------------------------------------------------------------

    // Load `file` and swap it in — MESSAGE thread only, since parsing a model allocates and reads JSON off disk.
    bool loadModel(const juce::File& file, juce::String& error);

    // The model's own sample rate, or 0: it is trained at one rate and this plugin does NOT resample.
    double modelSampleRate() const { return modelRate_.load(std::memory_order_relaxed); }

    /** The model file currently loaded (empty when none). */
    juce::String modelPath() const;

private:
    // The loaded model, swapped under `lock_` — which the audio thread only ever TRIES, since blocking is a dropout.
    juce::SpinLock lock_;
    std::unique_ptr<nam::DSP> dsp_;
    juce::String path_;
    std::atomic<double> modelRate_{0.0};

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

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(NamPlugin)
};

}  // namespace studio
