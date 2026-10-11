// TidalModulatorPlugin.h — Tides 2 at audio rate as a polyphonic instrument: a sculpted slope,
// spread over four outputs by SHIFT and mixed to stereo, with an ADSR per voice.

#pragma once

#include "EurorackPlugin.h"
#include "cores/TidesCore.h"

namespace studio::eurorack {

class TidalModulatorPlugin : public EurorackPlugin {
public:
    explicit TidalModulatorPlugin(tracktion::engine::PluginCreationInfo);

    static const char* getPluginName() { return "mu-tides"; }
    static const char* xmlTypeName;
    static juce::ValueTree create() { return createState(xmlTypeName); }

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "mu-tides"; }
    juce::String getSelectableDescription() override { return getPluginName(); }

private:
    void prepareCore(double) override { core_.init(); }
    void clearCore() override { core_.silence(); }
    void readParams() override;
    void handleMidi(const juce::MidiMessage&) override;
    void renderBlock(const float* const*, float* const* out) override { core_.render(out[0], out[1]); }

    TidesCore core_;
    Param output_, shape_, slope_, smoothness_, shift_, attack_, decay_, sustain_, release_, voices_,
        transpose_;
};

}  // namespace studio::eurorack
