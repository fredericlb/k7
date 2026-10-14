#include "MacroOscillator2Plugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* MacroOscillator2Plugin::xmlTypeName = "studio_macro_oscillator_2";

MacroOscillator2Plugin::MacroOscillator2Plugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {PlaitsCore::RATE, PlaitsCore::BLOCK, 0, true})
{
    juce::StringArray models;
    for (int e = 0; e < PlaitsCore::ENGINES; ++e) models.add(PlaitsCore::engineName(e));
    model_ = choice("model", "Model", models, 8);
    harmonics_ = knob("harmonics", "Harmonics", 0.0f, 1.0f, 0.5f);
    timbre_ = knob("timbre", "Timbre", 0.0f, 1.0f, 0.5f);
    morph_ = knob("morph", "Morph", 0.0f, 1.0f, 0.5f);
    // The module's three attenuverters, fed by its internal decay since a note is a trigger.
    pitchEnv_ = knob("pitchEnv", "Pitch env", -1.0f, 1.0f, 0.0f);
    timbreEnv_ = knob("timbreEnv", "Timbre env", -1.0f, 1.0f, 0.0f);
    morphEnv_ = knob("morphEnv", "Morph env", -1.0f, 1.0f, 0.0f);
    decay_ = knob("decay", "Decay", 0.0f, 1.0f, 0.5f);
    colour_ = knob("colour", "LPG colour", 0.0f, 1.0f, 0.5f);
    envelope_ = choice("envelope", "Envelope", {"gate", "ping"}, 0);
    voices_ = knob("voices", "Voices", 1.0f, (float)PlaitsCore::MAX_VOICES, 8.0f);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
    output_ = choice("output", "Output", {"main", "aux", "main + aux"}, 0);
}

void MacroOscillator2Plugin::readParams()
{
    auto& p = core_.params;
    p.engine = index(model_);
    p.harmonics = harmonics_->getCurrentValue();
    p.timbre = timbre_->getCurrentValue();
    p.morph = morph_->getCurrentValue();
    p.pitchEnv = pitchEnv_->getCurrentValue();
    p.timbreEnv = timbreEnv_->getCurrentValue();
    p.morphEnv = morphEnv_->getCurrentValue();
    p.decay = decay_->getCurrentValue();
    p.colour = colour_->getCurrentValue();
    p.ping = index(envelope_) == 1;
    p.voices = index(voices_);
    p.transpose = transpose_->getCurrentValue();
    p.output = index(output_);
}

void MacroOscillator2Plugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

}  // namespace studio::eurorack
