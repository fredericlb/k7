#include "ModalSynthesizerPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* ModalSynthesizerPlugin::xmlTypeName = "studio_modal_synthesizer";

ModalSynthesizerPlugin::ModalSynthesizerPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {ElementsCore::RATE, ElementsCore::BLOCK, 4, true})
{
    juce::StringArray models;
    for (int m = 0; m < ElementsCore::MODELS; ++m) models.add(ElementsCore::modelName(m));
    // Defaults are the firmware's own Part::Init values, so a fresh module sounds like a fresh module.
    model_ = choice("model", "Model", models, 0);
    contour_ = knob("contour", "Contour", 0.0f, 1.0f, 1.0f);
    bowLevel_ = knob("bowLevel", "Bow", 0.0f, 1.0f, 0.0f);
    bowTimbre_ = knob("bowTimbre", "Bow timbre", 0.0f, 1.0f, 0.5f);
    blowLevel_ = knob("blowLevel", "Blow", 0.0f, 1.0f, 0.0f);
    flow_ = knob("flow", "Flow", 0.0f, 1.0f, 0.5f);
    blowTimbre_ = knob("blowTimbre", "Blow timbre", 0.0f, 1.0f, 0.5f);
    strikeLevel_ = knob("strikeLevel", "Strike", 0.0f, 1.0f, 0.8f);
    mallet_ = knob("mallet", "Mallet", 0.0f, 1.0f, 0.5f);
    strikeTimbre_ = knob("strikeTimbre", "Strike timbre", 0.0f, 1.0f, 0.5f);
    geometry_ = knob("geometry", "Geometry", 0.0f, 1.0f, 0.2f);
    brightness_ = knob("brightness", "Brightness", 0.0f, 1.0f, 0.5f);
    damping_ = knob("damping", "Damping", 0.0f, 1.0f, 0.25f);
    position_ = knob("position", "Position", 0.0f, 1.0f, 0.3f);
    // Up to 2 as on the module: past 1 the reverb FREEZES.
    space_ = knob("space", "Space", 0.0f, 2.0f, 0.5f);
    input_ = choice("input", "Input", {"strike", "blow", "both"}, 0);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
}

void ModalSynthesizerPlugin::readParams()
{
    auto& p = core_.params;
    p.model = index(model_);
    p.contour = contour_->getCurrentValue();
    p.bowLevel = bowLevel_->getCurrentValue();
    p.bowTimbre = bowTimbre_->getCurrentValue();
    p.blowLevel = blowLevel_->getCurrentValue();
    p.flow = flow_->getCurrentValue();
    p.blowTimbre = blowTimbre_->getCurrentValue();
    p.strikeLevel = strikeLevel_->getCurrentValue();
    p.mallet = mallet_->getCurrentValue();
    p.strikeTimbre = strikeTimbre_->getCurrentValue();
    p.geometry = geometry_->getCurrentValue();
    p.brightness = brightness_->getCurrentValue();
    p.damping = damping_->getCurrentValue();
    p.position = position_->getCurrentValue();
    p.space = space_->getCurrentValue();
    p.input = index(input_);
    p.transpose = transpose_->getCurrentValue();
}

void ModalSynthesizerPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

void ModalSynthesizerPlugin::renderBlock(const float* const* in, float* const* out)
{
    // The lane's own audio plus a cable into `in`, each pair averaged — the same exciter input as mu-rings.
    for (int i = 0; i < ElementsCore::BLOCK; ++i)
        mono_[i] = 0.5f * (in[0][i] + in[1][i]) + 0.5f * (in[2][i] + in[3][i]);
    core_.render(mono_, out[0], out[1]);
}

}  // namespace studio::eurorack
