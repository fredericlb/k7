// ResonatorPlugin.h — Rings as an instrument AND an effect: notes tune and strum it, the track's
// audio excites it. On a track with no audio it is a plucked instrument (the internal exciter).

#pragma once

#include "EurorackPlugin.h"
#include "cores/RingsCore.h"

namespace studio::eurorack {

class ResonatorPlugin : public EurorackPlugin {
public:
    explicit ResonatorPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Resonator"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Reso"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const* in, float* const* out) override;

    RingsCore core_;
    float mono_[RingsCore::BLOCK] = {};
    Param model_, polyphony_, structure_, brightness_, damping_, position_, exciter_, transpose_;
};

}  // namespace studio::eurorack
