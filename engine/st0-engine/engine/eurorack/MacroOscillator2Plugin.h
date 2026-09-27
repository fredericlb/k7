// MacroOscillator2Plugin.h — Plaits' 24 synthesis models as a polyphonic instrument. Named
// mu-plaits, like every module here: mu- and the original's name (docs/eurorack.md).

#pragma once

#include "EurorackPlugin.h"
#include "cores/PlaitsCore.h"

namespace studio::eurorack {

class MacroOscillator2Plugin : public EurorackPlugin {
public:
    explicit MacroOscillator2Plugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "mu-plaits"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "mu-plaits"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const*, float* const* out) override { core_.render(out[0], out[1]); }

    PlaitsCore core_;
    Param model_, harmonics_, timbre_, morph_, pitchEnv_, timbreEnv_, morphEnv_, decay_, colour_,
        envelope_, voices_, transpose_, output_;
};

}  // namespace studio::eurorack
