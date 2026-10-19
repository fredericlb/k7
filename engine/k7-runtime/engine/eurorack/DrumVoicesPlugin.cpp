#include "DrumVoicesPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* DrumVoicesPlugin::xmlTypeName = "studio_drum_voices";

DrumVoicesPlugin::DrumVoicesPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {PeaksCore::RATE, PeaksCore::BLOCK, 0, true})
{
    kickPitch_ = knob("kickPitch", "Kick pitch", 0.0f, 1.0f, 0.5f);
    kickPunch_ = knob("kickPunch", "Kick punch", 0.0f, 1.0f, 0.6f);
    kickTone_ = knob("kickTone", "Kick tone", 0.0f, 1.0f, 0.5f);
    kickDecay_ = knob("kickDecay", "Kick decay", 0.0f, 1.0f, 0.5f);
    snarePitch_ = knob("snarePitch", "Snare pitch", 0.0f, 1.0f, 0.5f);
    snareTone_ = knob("snareTone", "Snare tone", 0.0f, 1.0f, 0.5f);
    snareSnappy_ = knob("snareSnappy", "Snare snappy", 0.0f, 1.0f, 0.5f);
    snareDecay_ = knob("snareDecay", "Snare decay", 0.0f, 1.0f, 0.5f);
    fmPitch_ = knob("fmPitch", "FM drum pitch", 0.0f, 1.0f, 0.5f);
    fmAmount_ = knob("fmAmount", "FM drum FM", 0.0f, 1.0f, 0.5f);
    fmDecay_ = knob("fmDecay", "FM drum decay", 0.0f, 1.0f, 0.5f);
    fmNoise_ = knob("fmNoise", "FM drum noise", 0.0f, 1.0f, 0.2f);
}

void DrumVoicesPlugin::readParams()
{
    auto& p = core_.params;
    p.kickPitch = kickPitch_->getCurrentValue();
    p.kickPunch = kickPunch_->getCurrentValue();
    p.kickTone = kickTone_->getCurrentValue();
    p.kickDecay = kickDecay_->getCurrentValue();
    p.snarePitch = snarePitch_->getCurrentValue();
    p.snareTone = snareTone_->getCurrentValue();
    p.snareSnappy = snareSnappy_->getCurrentValue();
    p.snareDecay = snareDecay_->getCurrentValue();
    p.fmPitch = fmPitch_->getCurrentValue();
    p.fmAmount = fmAmount_->getCurrentValue();
    p.fmDecay = fmDecay_->getCurrentValue();
    p.fmNoise = fmNoise_->getCurrentValue();
}

void DrumVoicesPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

}  // namespace studio::eurorack
