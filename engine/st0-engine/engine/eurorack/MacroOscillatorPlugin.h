// MacroOscillatorPlugin.h — Braids' 47 shapes as a polyphonic instrument with an ADSR per voice.
// Descriptive name, as for every module here: the original's is its author's trademark.

#pragma once

#include "EurorackPlugin.h"
#include "cores/BraidsCore.h"

namespace studio::eurorack {

class MacroOscillatorPlugin : public EurorackPlugin {
public:
    explicit MacroOscillatorPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Macro Oscillator"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "MacOsc"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const*, float* const* out) override { core_.render(out[0], out[1]); }

    BraidsCore core_;
    Param shape_, timbre_, color_, attack_, decay_, sustain_, release_, timbreEnv_, colorEnv_, bits_,
        rate_, voices_, transpose_;
};

}  // namespace studio::eurorack
