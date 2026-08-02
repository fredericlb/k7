// MidiGraphPlugin.h — GraphDspPlugin's MIDI twin: a built-in whose behaviour is a DESCRIPTION, running over the
// note stream instead of the audio buffer (see DspGraph::processMidi).
//
// A separate plugin rather than a flag on GraphDspPlugin, because Tracktion routes the two differently and says
// so through the type: `takesAudioInput()` false and `canBeAddedToClip()` false is what makes a plugin a MIDI
// effect, and a plugin cannot be both — an audio effect sits in the signal path after the instrument, a MIDI one
// before it. The scan cache tags them `audioEffect` and `midiEffect`, which is what files a module under
// audio/ or transformers/. One class answering both would have to lie to one of them.
//
// Everything else is shared: same graph format, same JS build step, same parameters-from-the-description.

#pragma once

#include "DspGraph.h"

#include <memory>
#include <vector>

namespace lanes {

class MidiGraphPlugin : public tracktion::engine::Plugin {
public:
    explicit MidiGraphPlugin(tracktion::engine::PluginCreationInfo info);
    ~MidiGraphPlugin() override;

    static const char* getPluginName() { return "MIDI Graph"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    /** The graph used when the state names none — a transpose of 0, i.e. audibly a pass-through. */
    static const char* defaultGraphJson();

    juce::String getName() const override { return "MIDI Graph"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "MIDI"; }
    juce::String getSelectableDescription() override { return "MIDI Graph"; }

    // The three answers that make this a MIDI effect rather than an audio one.
    bool takesAudioInput() override { return false; }
    bool canBeAddedToClip() override { return false; }
    bool producesAudioWhenNoAudioInput() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override { return n; }
    void getChannelNames(juce::StringArray*, juce::StringArray*) override {}

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

private:
    std::unique_ptr<DspGraph> graph_;
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;
    // Read once per block and handed over, so the graph never touches Tracktion's parameter objects.
    std::vector<float> scratch_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MidiGraphPlugin)
};

}  // namespace lanes
