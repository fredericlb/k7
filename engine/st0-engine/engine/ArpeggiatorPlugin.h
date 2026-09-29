// ArpeggiatorPlugin.h — the arpeggiator as a built-in MIDI effect: it EATS the chord it is given
// and plays notes of its own, which is the one thing a DspGraph node cannot be (docs/arpeggiator.md).
//
// The three answers that make a plugin a MIDI effect are MidiGraphPlugin's, and for its reasons.
// The one thing a reader would get wrong: none of the arithmetic is here. Arpeggiator.h holds the
// clock and the walk; this file only turns three parameters into seconds and events into messages.

#pragma once

#include "Arpeggiator.h"

#include <tracktion_engine/tracktion_engine.h>

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace studio {

class ArpeggiatorPlugin : public tracktion::engine::Plugin {
public:
    explicit ArpeggiatorPlugin(tracktion::engine::PluginCreationInfo info);
    ~ArpeggiatorPlugin() override;

    static const char* getPluginName() { return "Arpeggiator"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Arpeggiator"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Arp"; }
    juce::String getSelectableDescription() override { return "Arpeggiator"; }

    // The three answers that make this a MIDI effect rather than an audio one — see MidiGraphPlugin.h.
    bool takesAudioInput() override { return false; }
    bool canBeAddedToClip() override { return false; }
    bool producesAudioWhenNoAudioInput() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override { return n; }
    void getChannelNames(juce::StringArray*, juce::StringArray*) override {}

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    /** Let go of the chord. The base class is a no-op, so a held note would outlive every stop. */
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** What each `Rate` setting is worth in BEATS — index for index with the labels below. */
    static constexpr std::array<double, 8> rateBeats{4.0,  2.0,       1.0,  2.0 / 3.0,
                                                     0.5,  1.0 / 3.0, 0.25, 0.125};
    /** The setting a fresh arpeggiator is on: a sixteenth, which is what the word means (docs/arpeggiator.md). */
    static constexpr int rateDefault = 6;

private:
    /** One step in seconds: the rate is a musical division, so the edit's tempo is what makes it a time. */
    double stepSeconds();
    float paramValue(int index) const;

    Arpeggiator arp_;
    // Raised by midiPanic()/reset() on the message thread, honoured by the next block: arp_ is the audio thread's (docs/panic.md).
    std::atomic<bool> resetPending_{false};
    double sampleRate_ = 44100.0;
    // Everything that is not a note, kept while the buffer is rebuilt — a member, so no block allocates.
    tracktion::engine::MidiMessageArray passThrough_;
    std::vector<ArpEvent> events_;
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ArpeggiatorPlugin)
};

}  // namespace studio
