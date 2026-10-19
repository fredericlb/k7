#include "MetaModulatorPlugin.h"

#include "MidiNotes.h"

namespace studio::eurorack {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* MetaModulatorPlugin::xmlTypeName = "studio_meta_modulator";

// At the module's own 96 kHz: Init takes a rate, but its pitch table and filter bank assume that one.
MetaModulatorPlugin::MetaModulatorPlugin(tracktion::engine::PluginCreationInfo info)
    : EurorackPlugin(std::move(info), {WarpsCore::RATE, WarpsCore::BLOCK, 4, true})
{
    algorithm_ = knob("algorithm", "Algorithm", 0.0f, 1.0f, 0.0f);
    timbre_ = knob("timbre", "Timbre", 0.0f, 1.0f, 0.5f);
    carrierLevel_ = knob("carrierLevel", "Carrier level", 0.0f, 1.0f, 0.5f);
    modulatorLevel_ = knob("modulatorLevel", "Modulator level", 0.0f, 1.0f, 0.5f);
    carrier_p_ = choice("carrier", "Carrier", {"sidechain", "sine", "triangle", "saw"}, 1);
    transpose_ = knob("transpose", "Transpose", -24.0f, 24.0f, 0.0f, "st");
    output_ = choice("output", "Output", {"main", "main + aux"}, 0);
}

void MetaModulatorPlugin::readParams()
{
    auto& p = core_.params;
    p.algorithm = algorithm_->getCurrentValue();
    p.timbre = timbre_->getCurrentValue();
    p.carrierLevel = carrierLevel_->getCurrentValue();
    p.modulatorLevel = modulatorLevel_->getCurrentValue();
    p.carrier = index(carrier_p_);
    p.transpose = transpose_->getCurrentValue();
    p.stereo = index(output_) == 1;
}

void MetaModulatorPlugin::handleMidi(const juce::MidiMessage& m)
{
    dispatchNotes(m, core_);
}

void MetaModulatorPlugin::renderBlock(const float* const* in, float* const* out)
{
    for (int i = 0; i < WarpsCore::BLOCK; ++i) {
        modulator_[i] = 0.5f * (in[0][i] + in[1][i]);
        carrier_[i] = 0.5f * (in[2][i] + in[3][i]);
    }
    core_.render(carrier_, modulator_, out[0], out[1]);
}

}  // namespace studio::eurorack
