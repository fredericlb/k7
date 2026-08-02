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

// NAM_SAMPLE is `float` for us, so the model reads JUCE's buffers directly; the default double would cost a
// convert out and back around every block.
#include <NAM/dsp.h>

namespace lanes {

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
    // An amp has a tail — the model is recurrent and keeps ringing after the input stops — and saying otherwise
    // lets the renderer cut the note off at its last sample.
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

    // --- level ---------------------------------------------------------------
    //
    // A model is trained at whatever level its author played at, and a .nam file DECLARES that level. Ours arrives
    // 6.6 dB below what went in, which reads as "the amp does nothing" long before it reads as a gain staging
    // problem. `Normalize` reads that declared loudness and puts every model at the same output level, so swapping
    // amps stops being a volume change; `Input` and `Output` are the trims for after that — and `Input` is a real
    // tone control, since how hard you hit a modelled amp is half of what it sounds like.

    tracktion::engine::AutomatableParameter::Ptr inputDb, outputDb, normalize;
    juce::CachedValue<float> inputDbValue, outputDbValue, normalizeValue;

    // The loudness the model declares, in dB, or nothing when it declares none — older files and any model whose
    // trainer skipped the measurement. Then `Normalize` has nothing to work from and does nothing, which is worth
    // saying out loud; EditBuilder does the saying, since it is the one that knows which module this is.
    std::optional<double> modelLoudness() const;

    // What `Normalize` aims for, in dB. The figure the official NAM plugin uses: models are shared between the two
    // and a profile that sat right there should sit right here.
    static constexpr double targetLoudnessDb = -18.0;

    // --- model ---------------------------------------------------------------

    // Load `file` and swap it in. MESSAGE thread only: parsing a model allocates and reads JSON off disk. Returns
    // false and keeps any model already loaded when the file can't be read, with `error` saying why.
    bool loadModel(const juce::File& file, juce::String& error);

    // The model's own sample rate, or 0 when none is loaded or declared. A model is trained at one rate and this
    // plugin does NOT resample, so another rate sounds wrong in a way worth reporting.
    double modelSampleRate() const { return modelRate_.load(std::memory_order_relaxed); }

    /** The model file currently loaded (empty when none). */
    juce::String modelPath() const;

private:
    // The loaded model, swapped under `lock_`. The audio thread only ever TRIES that lock: mid-swap it passes the
    // block through clean rather than waiting, because blocking on a message-thread allocation is how you drop out.
    juce::SpinLock lock_;
    std::unique_ptr<nam::DSP> dsp_;
    juce::String path_;
    std::atomic<double> modelRate_{0.0};

    // Read on the audio thread every block, written on the message thread by loadModel — hence atomics, and hence
    // two of them rather than an optional.
    std::atomic<double> loudnessDb_{0.0};
    std::atomic<bool> hasLoudness_{false};

    // The gains the last block ENDED on. These are knobs (and Normalize is a 6 dB step), so every block ramps from
    // where the last one left off rather than jumping and clicking.
    float lastInGain_ = 1.0f;
    float lastOutGain_ = 1.0f;

    // The rate and block size Tracktion last prepared us with, so a model loaded AFTER initialise() can be reset to
    // the right shape — a model is loaded whenever the user picks one, rarely as the plugin is built.
    double sampleRate_ = 44100.0;
    int blockSize_ = 512;

    // The mono buffer the model reads and writes. Sized in initialise() and on every load, never in applyToBuffer:
    // allocating on the audio thread is the other way to get a dropout.
    juce::AudioBuffer<float> mono_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(NamPlugin)
};

}  // namespace lanes
