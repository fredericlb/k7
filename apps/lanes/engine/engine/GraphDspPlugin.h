// GraphDspPlugin.h — a Tracktion built-in whose DSP is DATA: it parses a graph description at construction and
// runs it (see DspGraph.h). The experiment is whether a module's audio can be authored the way a chain is —
// described in text, emitted by JS at load — instead of compiled into the engine.
//
// Its parameters are declared BY the graph, which is why the description has to be readable in the constructor:
// Tracktion plugins create their AutomatableParameters there and never after. PluginCreationInfo carries the
// ValueTree, so a `graph` property on the state is available exactly when it is needed.

#pragma once

#include "DspGraph.h"

#include <memory>
#include <vector>

namespace lanes {

class GraphDspPlugin : public tracktion::engine::Plugin {
public:
    explicit GraphDspPlugin(tracktion::engine::PluginCreationInfo info);
    ~GraphDspPlugin() override;

    static const char* getPluginName() { return "DSP Graph"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    /** The graph the plugin falls back to when its state names none — the Auto Wah, as data. */
    static const char* defaultGraphJson();

    juce::String getName() const override { return "DSP Graph"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Graph"; }
    juce::String getSelectableDescription() override { return "DSP Graph"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    bool noTail() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

private:
    std::unique_ptr<DspGraph> graph_;
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;
    // Read once per block and handed to the graph, so the audio path never touches Tracktion's parameter objects.
    std::vector<float> scratch_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(GraphDspPlugin)
};

}  // namespace lanes
