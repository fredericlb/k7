// DrumVoicesPlugin.h — Peaks' four drum voices as a drum instrument on the General MIDI map:
// kick on 35-36, snare on 37-40, hi-hat on 42/44/46, and the FM drum on every other note.

#pragma once

#include "EurorackPlugin.h"
#include "cores/PeaksCore.h"

namespace studio::eurorack {

class DrumVoicesPlugin : public EurorackPlugin {
public:
    explicit DrumVoicesPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "Drum Voices"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Drums"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const*, float* const* out) override { core_.render(out[0], out[1]); }

    PeaksCore core_;
    Param kickPitch_, kickPunch_, kickTone_, kickDecay_, snarePitch_, snareTone_, snareSnappy_,
        snareDecay_, fmPitch_, fmAmount_, fmDecay_, fmNoise_;
};

}  // namespace studio::eurorack
