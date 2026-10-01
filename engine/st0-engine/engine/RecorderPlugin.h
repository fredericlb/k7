// RecorderPlugin.h — the RECORDER node: a transparent plugin that copies what passes through it
// into a RecorderTap it does NOT own. Declared by the document like any other module, unlike the
// two taps beside it, which the engine inserts on demand. Passes audio through untouched — the
// capture is a side effect. See docs/recorder.md.

#pragma once

#include "HeldMemory.h"
#include "RecorderTap.h"
// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include <atomic>

namespace studio {

class RecorderPlugin : public tracktion::engine::Plugin, public HeldMemory {
public:
    RecorderPlugin(tracktion::engine::PluginCreationInfo info)
        : Plugin(std::move(info))
    {
        setProcessingEnabled(true);
    }

    ~RecorderPlugin() override
    {
        notifyListenersOfDeletion();
    }

    static const char* getPluginName()               { return "Recorder"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override                 { return "Recorder"; }
    juce::String getPluginType() override                  { return xmlTypeName; }
    juce::String getShortName(int) override                { return "Rec"; }
    juce::String getSelectableDescription() override       { return "Recorder Plugin"; }
    bool canBeDisabled() override                          { return true; }
    bool shouldMeasureCpuUsage() const noexcept override   { return false; }
    bool noTail() override                                 { return true; }
    bool takesAudioInput() override                        { return true; }
    bool producesAudioWhenNoAudioInput() override          { return false; }

    // UNCHANGED, as the broadcast tap's is: this one sits in a MODULE chain, where clamping to two
    // would make dropping a recorder into a wider run silently narrow the signal.
    int getNumOutputChannelsGivenInputs(int numInputChannels) override
    {
        return numInputChannels;
    }

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override
    {
        // The rate the samples are actually at: the wav header is written from it, and a header
        // that disagrees with the samples is a file that plays at the wrong pitch for ever.
        if (auto* t = tap_.load(std::memory_order_relaxed))
            t->setSampleRate(info.sampleRate);
    }
    void deinitialise() override {}
    // NO reset() override: the ring's read cursor belongs to the writer thread, and touching it
    // from graph preparation would read back as a spurious multi-million-frame loss.

    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override
    {
        auto* tap = tap_.load(std::memory_order_relaxed);
        if (tap == nullptr || !ctx.destBuffer) return;
        const int numChans = ctx.destBuffer->getNumChannels();
        if (numChans <= 0) return;

        // Read pointers already offset, so the tap takes no start index and cannot be handed a
        // block it reads from the wrong place.
        const float* chans[RecorderTap::CHANNELS] = {};
        for (int c = 0; c < RecorderTap::CHANNELS; ++c)
            chans[c] = ctx.destBuffer->getReadPointer(c < numChans ? c : 0,
                                                      ctx.bufferStartSample);
        tap->pushBlock(chans, juce::jmin(numChans, RecorderTap::CHANNELS),
                       ctx.bufferNumSamples);
    }

    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}

    // --- Wiring -------------------------------------------------------------

    // The ring lives in EngineHost, keyed by this module's id, so a rebuild of the chain around
    // this node does not end the take in progress: the new plugin is pointed at the same ring.
    void setTap(RecorderTap* tap) { tap_.store(tap, std::memory_order_relaxed); }

    /** The ring it writes into — owned by EngineHost, but held for this node alone. */
    int64_t heldBytes() const noexcept override
    {
        const auto* t = tap_.load(std::memory_order_relaxed);
        return t != nullptr ? (int64_t)t->bytes() : 0;
    }

private:
    std::atomic<RecorderTap*> tap_{nullptr};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RecorderPlugin)
};

}  // namespace studio
