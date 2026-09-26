// MetaModulatorPlugin.h — Warps as an effect: the track's audio is the MODULATOR; the carrier is
// the internal oscillator, which notes play, or the sidechain. Its algorithms end in a vocoder.

#pragma once

#include "EurorackPlugin.h"
#include "cores/WarpsCore.h"

namespace studio::eurorack {

class MetaModulatorPlugin : public EurorackPlugin {
public:
    explicit MetaModulatorPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Meta Modulator"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "MetaMod"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double rate) override { core_.init(rate); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const* in, float* const* out) override;

    WarpsCore core_;
    float modulator_[WarpsCore::BLOCK] = {}, carrier_[WarpsCore::BLOCK] = {};
    Param algorithm_, timbre_, carrierLevel_, modulatorLevel_, carrier_p_, transpose_, output_;
};

}  // namespace studio::eurorack
