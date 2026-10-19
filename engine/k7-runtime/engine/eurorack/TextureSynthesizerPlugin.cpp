#include "TextureSynthesizerPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* TextureSynthesizerPlugin::xmlTypeName = "studio_texture_synthesizer";

TextureSynthesizerPlugin::TextureSynthesizerPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {CloudsCore::RATE, CloudsCore::BLOCK, 2, true})
{
    juce::StringArray modes, qualities;
    for (int i = 0; i < 4; ++i) modes.add(CloudsCore::modeName(i));
    for (int i = 0; i < 4; ++i) qualities.add(CloudsCore::qualityName(i));
    mode_ = choice("mode", "Mode", modes, 0);
    quality_ = choice("quality", "Quality", qualities, 0);
    position_ = knob("position", "Position", 0.0f, 1.0f, 0.5f);
    size_ = knob("size", "Size", 0.0f, 1.0f, 0.5f);
    pitch_ = knob("pitch", "Pitch", -24.0f, 24.0f, 0.0f, "st");
    density_ = knob("density", "Density", 0.0f, 1.0f, 0.5f);
    texture_ = knob("texture", "Texture", 0.0f, 1.0f, 0.5f);
    // The four settings of the module's one BLEND knob, each its own parameter here.
    dryWet_ = knob("dryWet", "Dry/wet", 0.0f, 1.0f, 0.5f);
    spread_ = knob("spread", "Spread", 0.0f, 1.0f, 0.5f);
    feedback_ = knob("feedback", "Feedback", 0.0f, 1.0f, 0.0f);
    reverb_ = knob("reverb", "Reverb", 0.0f, 1.0f, 0.0f);
    freeze_ = choice("freeze", "Freeze", {"off", "on"}, 0);
    follow_ = choice("follow", "Follow notes", {"off", "on"}, 0);
}

void TextureSynthesizerPlugin::readParams()
{
    auto& p = core_.params;
    p.mode = index(mode_);
    p.quality = index(quality_);
    p.position = position_->getCurrentValue();
    p.size = size_->getCurrentValue();
    p.pitch = pitch_->getCurrentValue();
    p.density = density_->getCurrentValue();
    p.texture = texture_->getCurrentValue();
    p.dryWet = dryWet_->getCurrentValue();
    p.spread = spread_->getCurrentValue();
    p.feedback = feedback_->getCurrentValue();
    p.reverb = reverb_->getCurrentValue();
    p.freeze = index(freeze_) == 1;
    p.followNotes = index(follow_) == 1;
}

void TextureSynthesizerPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

}  // namespace studio::eurorack
