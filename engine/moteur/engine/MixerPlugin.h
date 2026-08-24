// MixerPlugin.h — the channel strip, as a module: level, pan and a three-knob tone control.
//
// It exists because a track carries no `volume`/`pan` of its own. As track fields they are the one part of a
// track's sound living outside its chain, so the graph cannot show where they apply and no module can be put
// after them. Here they are a module like any other: placed, ordered, bypassed, automated.
//
// The EQ is three GAINS at fixed frequencies — a low shelf, a mid bell, a high shelf. Not an EQ to shape a sound
// with; an EQ to sit a track in a mix, which is what a strip's tone stack has always been. Anything more belongs
// to a real equaliser module further up the chain.
//
// Level and pan go through Tracktion's own getGainsFromVolumeFaderPositionAndPan, so this reproduces Tracktion's
// fader exactly, pan law included, rather than approximating it with a law of its own.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <memory>
#include <vector>

namespace studio {

class MixerPlugin : public tracktion::engine::Plugin {
public:
    explicit MixerPlugin(tracktion::engine::PluginCreationInfo info);
    ~MixerPlugin() override;

    static const char* getPluginName() { return "Mixer"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Mixer"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Mix"; }
    juce::String getSelectableDescription() override { return "Mixer"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    bool noTail() override { return true; }

    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    // The tone stack's fixed frequencies, in Hz. Named here because the module's docs quote them and a test
    // asserts the shelves actually move the bands they claim to.
    static constexpr float lowHz = 200.0f;
    static constexpr float midHz = 1000.0f;
    static constexpr float highHz = 4000.0f;

private:
    struct Band {
        juce::IIRFilter ch[2];
    };
    Band low_, mid_, high_;
    // Set once per block from the parameters, so the per-sample path reads no Tracktion objects.
    float lastLowDb_ = 0.0f, lastMidDb_ = 0.0f, lastHighDb_ = 0.0f;
    bool coeffsValid_ = false;

    tracktion::engine::AutomatableParameter::Ptr volume_, pan_, lowGain_, midGain_, highGain_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;

    void updateCoefficients(float lowDb, float midDb, float highDb);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MixerPlugin)
};

}  // namespace studio
