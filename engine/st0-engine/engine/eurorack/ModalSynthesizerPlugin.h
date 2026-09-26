// ModalSynthesizerPlugin.h — Elements: bow, blow and strike exciting a resonator, monophonic.
// An instrument that also takes the track's audio as an exciter, as the module's two inputs do.

#pragma once

#include "EurorackPlugin.h"
#include "cores/ElementsCore.h"

namespace studio::eurorack {

class ModalSynthesizerPlugin : public EurorackPlugin {
public:
    explicit ModalSynthesizerPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Modal Synthesizer"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Modal"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const* in, float* const* out) override;

    ElementsCore core_;
    float mono_[ElementsCore::BLOCK] = {};
    Param model_, contour_, bowLevel_, bowTimbre_, blowLevel_, flow_, blowTimbre_, strikeLevel_,
        mallet_, strikeTimbre_, geometry_, brightness_, damping_, position_, space_, input_,
        transpose_;
};

}  // namespace studio::eurorack
