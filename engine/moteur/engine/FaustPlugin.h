// FaustPlugin.h — the built-in a `plugin: {type: faust}` module loads: handed its own Faust source in the
// document and expected to compile it. THIS BUILD DOES NOT: there is no Faust compiler linked in, so the
// plugin exists, says so once, and passes audio through. See engine/moteur/docs/faust.md.
//
// It is here rather than absent because the seam is what is being built first: a module reaches the engine,
// draws, addresses its parameters and refuses audibly, which is the state you want before deciding what a
// compiler costs. Everything above this file is finished; only compile() is a stub.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <string>

namespace studio {

class FaustPlugin : public tracktion::engine::Plugin {
public:
    explicit FaustPlugin(tracktion::engine::PluginCreationInfo info);
    ~FaustPlugin() override;

    static const char* getPluginName() { return "Faust"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    juce::String getName() const override { return "Faust"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Faust"; }
    juce::String getSelectableDescription() override { return "Faust"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    // A filter's tail is state, not silence — the same answer GraphDspPlugin gives, and for the day the
    // compiler is real. A stub that passed through would be fine either way.
    bool noTail() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;

    /** The source this instance was handed, as the document carried it — empty when the module named none. */
    const std::string& source() const { return source_; }

private:
    std::string source_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(FaustPlugin)
};

}  // namespace studio
