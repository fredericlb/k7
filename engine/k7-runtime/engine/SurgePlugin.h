// SurgePlugin.h — Surge XT as a Tracktion built-in: the synth plays the .fxp patch a module names, and every
// parameter of it but the MIDI ones is an automatable parameter here. Loaded like SfzPlugin's instrument: on the
// message thread, into a fresh synth swapped in under a lock the audio thread only ever tries. docs/surgePlugin.md.
//
// The parameters FOLLOW the synth: a patch load, or a type change resetting its slots, is read back onto them.

#pragma once

// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace studio {

namespace surge {
class SurgeCore;
}

class SurgePlugin : public tracktion::engine::Plugin, private juce::Timer {
public:
    explicit SurgePlugin(tracktion::engine::PluginCreationInfo info);
    ~SurgePlugin() override;

    static const char* getPluginName() { return "Surge XT"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Surge"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    bool takesAudioInput() override { return false; }
    bool takesMidiInput() override { return true; }
    bool isSynth() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return true; }
    // Release stages and the patch's own reverbs and delays ring past the last note.
    bool noTail() override { return false; }
    int getNumOutputChannelsGivenInputs(int) override { return 2; }

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override;
    void deinitialise() override;
    void reset() override;
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override;

    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    // --- parameters ------------------------------------------------------------

    tracktion::engine::AutomatableParameter::Ptr volumeDb;
    juce::CachedValue<float> volumeDbValue;

    // --- patch -----------------------------------------------------------------

    // Load the .fxp at `path` into a new synth and swap it in, its values onto the parameters — MESSAGE thread only.
    bool loadPatch(const juce::String& path, juce::String& error);

private:
    // The live synth, swapped under `lock_` — which the audio thread only TRIES, since blocking is a dropout.
    juce::SpinLock lock_;
    std::unique_ptr<surge::SurgeCore> core_;

    // One per SurgeCore::params() entry, in that order.
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;
    // The value the synth and the parameter last agreed on: the audio thread pushes past it, the timer reads back.
    std::unique_ptr<std::atomic<float>[]> agreed_;
    // The synth's values and `agreed_` as the AUDIO thread read them under the lock, for the timer: it never touches the synth.
    std::unique_ptr<std::atomic<float>[]> heard_;
    std::unique_ptr<std::atomic<float>[]> heardAgreed_;
    // The read-back handshake: the timer asks (kAsked), the audio thread publishes (kPublished) — docs/surgePlugin.md.
    enum : int { kIdle, kAsked, kPublished };
    std::atomic<int> readBack_{kIdle};

    // Surge's text for a value is read off a TWIN the message side owns, never the live synth (docs/surgePlugin.md).
    std::mutex twinMx_;
    std::unique_ptr<surge::SurgeCore> twin_;   // built on the first text asked for, dropped on a patch change
    std::vector<float> twinValues_;            // the live synth's values as last published, which the twin is brought to
    std::string patchPath_;                    // the patch the twin is built from; empty is Surge's Init

    // What the synth was last prepared with, so one loaded AFTER initialise() gets the same rate.
    double sampleRate_ = 48000.0;

    // Where the host is inside the synth's current fixed block; == block means the next sample renders a new one.
    int pos_ = 0;

    // Set off the audio thread, answered on it: a panic silences the synth between two blocks.
    std::atomic<bool> silencePending_{false};

    void swapIn(std::unique_ptr<surge::SurgeCore> fresh, const std::string& path);
    std::string displayText(size_t i, float value);
    void timerCallback() override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SurgePlugin)
};

}  // namespace studio
