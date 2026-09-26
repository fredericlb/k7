#include "TidalModulatorPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* TidalModulatorPlugin::xmlTypeName = "studio_tidal_modulator";

TidalModulatorPlugin::TidalModulatorPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {TidesCore::RATE, TidesCore::BLOCK, 0, true})
{
    juce::StringArray outputs;
    for (int i = 0; i < 3; ++i) outputs.add(TidesCore::outputName(i));
    output_ = choice("output", "Output mode", outputs, 2);
    shape_ = knob("shape", "Shape", 0.0f, 1.0f, 0.5f);
    slope_ = knob("slope", "Slope", 0.0f, 1.0f, 0.5f);
    smoothness_ = knob("smoothness", "Smoothness", 0.0f, 1.0f, 0.5f);
    shift_ = knob("shift", "Shift", 0.0f, 1.0f, 0.3f);
    attack_ = knob("attack", "Attack", 0.001f, 2.0f, 0.002f, "s");
    decay_ = knob("decay", "Decay", 0.005f, 4.0f, 0.3f, "s");
    sustain_ = knob("sustain", "Sustain", 0.0f, 1.0f, 0.8f);
    release_ = knob("release", "Release", 0.005f, 8.0f, 0.3f, "s");
    voices_ = knob("voices", "Voices", 1.0f, (float)TidesCore::MAX_VOICES, 8.0f);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
}

void TidalModulatorPlugin::readParams()
{
    auto& p = core_.params;
    p.output = index(output_);
    p.shape = shape_->getCurrentValue();
    p.slope = slope_->getCurrentValue();
    p.smoothness = smoothness_->getCurrentValue();
    p.shift = shift_->getCurrentValue();
    p.attack = attack_->getCurrentValue();
    p.decay = decay_->getCurrentValue();
    p.sustain = sustain_->getCurrentValue();
    p.release = release_->getCurrentValue();
    p.voices = index(voices_);
    p.transpose = transpose_->getCurrentValue();
}

void TidalModulatorPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

}  // namespace studio::eurorack
