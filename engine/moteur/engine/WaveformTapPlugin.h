// WaveformTapPlugin.h — a minimal Tracktion plugin that captures audio samples
// into a WaveformTap for real-time waveform display. Sits in a track's plugin
// chain (post-fader, like the LevelMeterPlugin) and is transparent to the audio
// — it passes samples through unchanged while also pushing min/max envelope data
// into a lock-free ring buffer.

#pragma once

#include "WaveformTap.h"
// The module header, not a path into a build tree: the FetchContent checkout lives under build/<preset>/_deps,
// so a relative path pins this file to whichever preset built first — it named macos-clang, so no Windows build
// could compile it at all.
#include <tracktion_engine/tracktion_engine.h>

namespace studio {

class WaveformTapPlugin : public tracktion::engine::Plugin {
public:
    WaveformTapPlugin(tracktion::engine::PluginCreationInfo info)
        : Plugin(std::move(info))
    {
        // Enable bypass-safe processing so the tap works even when bypassed
        setProcessingEnabled(true);
    }

    ~WaveformTapPlugin() override
    {
        notifyListenersOfDeletion();
    }

    static const char* getPluginName()               { return "Waveform Tap"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override                 { return "Waveform Tap"; }
    juce::String getPluginType() override                  { return xmlTypeName; }
    juce::String getShortName(int) override                { return "WfTap"; }
    juce::String getSelectableDescription() override       { return "Waveform Tap Plugin"; }
    bool canBeDisabled() override                          { return false; }
    bool shouldMeasureCpuUsage() const noexcept override   { return false; }
    bool noTail() override                                 { return true; }
    bool takesAudioInput() override                        { return true; }
    bool producesAudioWhenNoAudioInput() override          { return false; }

    int getNumOutputChannelsGivenInputs(int numInputChannels) override
    {
        return juce::jmin(numInputChannels, 2);
    }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override {}
    void deinitialise() override {}
    // Only the writer's half. reset() is called from graph preparation and transport repositioning —
    // i.e. beside the audio thread — and the ring's read cursor belongs to the message thread that
    // drains it. See WaveformTap::reset(), and BroadcastTapPlugin, which has no reset() for this reason.
    void reset() override { tap_.resetBucket(); }

    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override
    {
        if (!enabled_.load(std::memory_order_relaxed)) return;
        if (!ctx.destBuffer) return;

        const int numSamples = ctx.bufferNumSamples;
        const int startSample = ctx.bufferStartSample;

        // Push left channel samples (or mono if only one channel)
        if (ctx.destBuffer->getNumChannels() > 0) {
            const float* data = ctx.destBuffer->getReadPointer(0, startSample);
            for (int i = 0; i < numSamples; ++i)
                tap_.pushSample(data[i]);
        }

        // For stereo, also push the right channel, interleaved into the same tap — the browser can show L/R as two
        // st0 or as a mono sum.
        if (ctx.destBuffer->getNumChannels() > 1) {
            const float* data = ctx.destBuffer->getReadPointer(1, startSample);
            for (int i = 0; i < numSamples; ++i)
                tap_.pushSample(data[i]);
        }
    }

    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}

    // --- WaveformTap access -------------------------------------------------

    WaveformTap& tap() { return tap_; }
    void setEnabled(bool on) { enabled_.store(on, std::memory_order_relaxed); }
    bool isEnabled() const { return enabled_.load(std::memory_order_relaxed); }

private:
    WaveformTap tap_{256};  // 256-sample buckets → ~86 points/sec at 44.1 kHz
    std::atomic<bool> enabled_{true};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(WaveformTapPlugin)
};

}  // namespace studio
