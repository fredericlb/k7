#include "ResonatorPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* ResonatorPlugin::xmlTypeName = "studio_resonator";

ResonatorPlugin::ResonatorPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {RingsCore::RATE, RingsCore::BLOCK, 4, true})
{
    juce::StringArray models;
    for (int m = 0; m < RingsCore::MODELS; ++m) models.add(RingsCore::modelName(m));
    model_ = choice("model", "Model", models, 0);
    polyphony_ = choice("polyphony", "Polyphony", {"1", "2", "4"}, 0);
    structure_ = knob("structure", "Structure", 0.0f, 1.0f, 0.5f);
    brightness_ = knob("brightness", "Brightness", 0.0f, 1.0f, 0.5f);
    damping_ = knob("damping", "Damping", 0.0f, 1.0f, 0.5f);
    position_ = knob("position", "Position", 0.0f, 1.0f, 0.5f);
    exciter_ = choice("exciter", "Exciter", {"internal", "input only"}, 0);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
    glide_ = knob("glide", "Glide", 0.0f, 1.0f, 0.0f, "s");
}

void ResonatorPlugin::readParams()
{
    auto& p = core_.params;
    p.model = index(model_);
    p.polyphony = index(polyphony_);
    p.structure = structure_->getCurrentValue();
    p.brightness = brightness_->getCurrentValue();
    p.damping = damping_->getCurrentValue();
    p.position = position_->getCurrentValue();
    p.internalExciter = index(exciter_) == 0;
    p.transpose = transpose_->getCurrentValue();
    p.glide = glide_->getCurrentValue();
}

void ResonatorPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

void ResonatorPlugin::renderBlock(const float* const* in, float* const* out)
{
    // One exciter input on the module: each stereo pair averaged into it, the lane's own audio plus a cable into `in` (docs/eurorack.md).
    for (int i = 0; i < RingsCore::BLOCK; ++i)
        mono_[i] = 0.5f * (in[0][i] + in[1][i]) + 0.5f * (in[2][i] + in[3][i]);
    core_.render(mono_, out[0], out[1]);
}

}  // namespace studio::eurorack
