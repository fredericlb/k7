#include "MacroOscillatorPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* MacroOscillatorPlugin::xmlTypeName = "studio_macro_oscillator";

MacroOscillatorPlugin::MacroOscillatorPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {BraidsCore::RATE, BraidsCore::BLOCK, 0, true})
{
    juce::StringArray shapes, bits, rates;
    for (int s = 0; s < BraidsCore::SHAPES; ++s) shapes.add(BraidsCore::shapeName(s));
    for (int i = 0; i < 7; ++i) bits.add(BraidsCore::bitsName(i));
    for (int i = 0; i < 7; ++i) rates.add(BraidsCore::rateName(i));

    shape_ = choice("shape", "Shape", shapes, 0);
    timbre_ = knob("timbre", "Timbre", 0.0f, 1.0f, 0.5f);
    color_ = knob("color", "Color", 0.0f, 1.0f, 0.5f);
    attack_ = knob("attack", "Attack", 0.001f, 2.0f, 0.002f, "s");
    decay_ = knob("decay", "Decay", 0.005f, 4.0f, 0.3f, "s");
    sustain_ = knob("sustain", "Sustain", 0.0f, 1.0f, 0.8f);
    release_ = knob("release", "Release", 0.005f, 8.0f, 0.3f, "s");
    timbreEnv_ = knob("timbreEnv", "Timbre env", -1.0f, 1.0f, 0.0f);
    colorEnv_ = knob("colorEnv", "Color env", -1.0f, 1.0f, 0.0f);
    bits_ = choice("bits", "Bits", bits, 6);
    rate_ = choice("rate", "Sample rate", rates, 6);
    voices_ = knob("voices", "Voices", 1.0f, (float)BraidsCore::MAX_VOICES, 8.0f);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
}

void MacroOscillatorPlugin::readParams()
{
    auto& p = core_.params;
    p.shape = index(shape_);
    p.timbre = timbre_->getCurrentValue();
    p.color = color_->getCurrentValue();
    p.attack = attack_->getCurrentValue();
    p.decay = decay_->getCurrentValue();
    p.sustain = sustain_->getCurrentValue();
    p.release = release_->getCurrentValue();
    p.timbreEnv = timbreEnv_->getCurrentValue();
    p.colorEnv = colorEnv_->getCurrentValue();
    p.bits = index(bits_);
    p.rate = index(rate_);
    p.voices = index(voices_);
    p.transpose = transpose_->getCurrentValue();
}

void MacroOscillatorPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

}  // namespace studio::eurorack
