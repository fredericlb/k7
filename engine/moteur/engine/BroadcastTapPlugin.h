// BroadcastTapPlugin.h — a transparent Tracktion plugin that copies the audio passing
// through it into a BroadcastTap it does NOT own. Appended to the MASTER plugin list,
// beside the master LevelMeterPlugin, so it sees exactly the mix that leaves for the
// interface. Passes audio through untouched. See docs/broadcast.md.

#pragma once

#include "BroadcastTap.h"
// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include <atomic>

namespace studio {

class BroadcastTapPlugin : public tracktion::engine::Plugin {
public:
    BroadcastTapPlugin(tracktion::engine::PluginCreationInfo info)
        : Plugin(std::move(info))
    {
        setProcessingEnabled(true);
    }

    ~BroadcastTapPlugin() override
    {
        notifyListenersOfDeletion();
    }

    static const char* getPluginName()               { return "Broadcast Tap"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override                 { return "Broadcast Tap"; }
    juce::String getPluginType() override                  { return xmlTypeName; }
    juce::String getShortName(int) override                { return "BcTap"; }
    juce::String getSelectableDescription() override       { return "Broadcast Tap Plugin"; }
    bool canBeDisabled() override                          { return false; }
    bool shouldMeasureCpuUsage() const noexcept override   { return false; }
    bool noTail() override                                 { return true; }
    bool takesAudioInput() override                        { return true; }
    bool producesAudioWhenNoAudioInput() override          { return false; }

    // UNCHANGED, unlike WaveformTapPlugin's jmin(n, 2): this one sits on the MASTER list, where clamping would make enabling the broadcast alter what leaves the interface.
    int getNumOutputChannelsGivenInputs(int numInputChannels) override
    {
        return numInputChannels;
    }

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override
    {
        // The rate the samples are actually at: without it in the frame header a browser plays 44.1 kHz material into a 48 kHz context, which is a pitch shift.
        if (auto* t = tap_.load(std::memory_order_relaxed))
            t->setSampleRate(info.sampleRate);
    }
    void deinitialise() override {}
    // NO reset() override: the ring's read cursor belongs to the sender thread, and touching it from graph preparation would read back as a spurious multi-million-frame loss.

    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override
    {
        auto* tap = tap_.load(std::memory_order_relaxed);
        if (tap == nullptr || !ctx.destBuffer) return;
        const int numChans = ctx.destBuffer->getNumChannels();
        if (numChans <= 0) return;

        // Read pointers already offset, so the tap takes no start index and cannot be handed a block it reads from the wrong place.
        const float* chans[BroadcastTap::CHANNELS] = {};
        for (int c = 0; c < BroadcastTap::CHANNELS; ++c)
            chans[c] = ctx.destBuffer->getReadPointer(c < numChans ? c : 0,
                                                      ctx.bufferStartSample);
        tap->pushBlock(chans, juce::jmin(numChans, BroadcastTap::CHANNELS),
                       ctx.bufferNumSamples);
    }

    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}

    // --- Wiring -------------------------------------------------------------

    // The ring lives in EngineHost so a project apply cannot pull it out from under the sender, and is set before insertion so no audio callback sees the null.
    void setTap(BroadcastTap* tap) { tap_.store(tap, std::memory_order_relaxed); }

private:
    std::atomic<BroadcastTap*> tap_{nullptr};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BroadcastTapPlugin)
};

}  // namespace studio
