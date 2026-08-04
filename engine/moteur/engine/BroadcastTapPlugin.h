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

    // UNCHANGED, unlike WaveformTapPlugin's jmin(n, 2). That one sits mid-track where two
    // channels is the whole signal; this one sits on the MASTER list, so clamping here
    // would truncate a wider master's channels 3+ — enabling the broadcast would silently
    // change what leaves the interface, and disabling it would put it back. A tap must be
    // inaudible. te::LevelMeterPlugin, which it sits beside, reports the count unchanged too.
    int getNumOutputChannelsGivenInputs(int numInputChannels) override
    {
        return numInputChannels;
    }

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override
    {
        // The rate the samples are actually at. The frame header has to carry it, or the
        // browser plays 44.1 kHz material into a 48 kHz context — a pitch shift, which is
        // inaudible as a FAULT while being obvious as "the engine sounds wrong".
        if (auto* t = tap_.load(std::memory_order_relaxed))
            t->setSampleRate(info.sampleRate);
    }
    void deinitialise() override {}
    // NO reset() override. The ring's read cursor belongs to the sender thread, and reset()
    // is called from graph preparation and transport repositioning — touching it here would
    // race the drain and read back as a spurious multi-million-frame loss.

    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override
    {
        auto* tap = tap_.load(std::memory_order_relaxed);
        if (tap == nullptr || !ctx.destBuffer) return;
        const int numChans = ctx.destBuffer->getNumChannels();
        if (numChans <= 0) return;

        // Read pointers already offset, so the tap takes no start index and cannot be
        // handed a block it reads from the wrong place.
        const float* chans[BroadcastTap::CHANNELS] = {};
        for (int c = 0; c < BroadcastTap::CHANNELS; ++c)
            chans[c] = ctx.destBuffer->getReadPointer(c < numChans ? c : 0,
                                                      ctx.bufferStartSample);
        tap->pushBlock(chans, juce::jmin(numChans, BroadcastTap::CHANNELS),
                       ctx.bufferNumSamples);
    }

    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}

    // --- Wiring -------------------------------------------------------------

    // The ring lives in EngineHost, not here, so that a project apply — which destroys this
    // plugin along with the whole edit — cannot pull the buffer out from under the sender
    // thread. Set on the message thread before the plugin is inserted into any list, so no
    // audio callback ever sees the null.
    void setTap(BroadcastTap* tap) { tap_.store(tap, std::memory_order_relaxed); }

private:
    std::atomic<BroadcastTap*> tap_{nullptr};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BroadcastTapPlugin)
};

}  // namespace studio
