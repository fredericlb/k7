// TextureSynthesizerPlugin.h — Clouds as an audio effect: grains, stretches and loops of the
// track's own audio. Notes are optional, and fire a grain as the module's TRIG input does.

#pragma once

#include "EurorackPlugin.h"
#include "cores/CloudsCore.h"

namespace studio::eurorack {

class TextureSynthesizerPlugin : public EurorackPlugin {
public:
    explicit TextureSynthesizerPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Texture Synthesizer"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Texture"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const* in, float* const* out) override
    {
        core_.render(in[0], in[1], out[0], out[1]);
    }

    CloudsCore core_;
    Param mode_, quality_, position_, size_, pitch_, density_, texture_, dryWet_, spread_, feedback_,
        reverb_, freeze_, follow_;
};

}  // namespace studio::eurorack
