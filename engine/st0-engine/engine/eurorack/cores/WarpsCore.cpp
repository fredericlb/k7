// WarpsCore.cpp — the only file that sees warps::Modulator. 16-bit frames either side, as for
// Clouds: IN 1 is the carrier (or the internal oscillator's FM input), IN 2 the modulator.

#include "WarpsCore.h"

#include "warps/dsp/modulator.h"

#include <algorithm>
#include <cmath>

namespace studio::eurorack {

namespace {

short toShort(float x) { return (short)std::clamp((int)std::lround(x * 32767.0f), -32768, 32767); }

}  // namespace

struct WarpsCore::Impl {
    warps::Modulator modulator;
    warps::ShortFrame in[BLOCK], out[BLOCK];
    float note = 60.0f;
};

WarpsCore::WarpsCore() : impl_(std::make_unique<Impl>()) {}
WarpsCore::~WarpsCore() = default;

void WarpsCore::init(double sampleRate)
{
    impl_->modulator.Init((float)sampleRate);
}

void WarpsCore::noteOn(int key, float)
{
    impl_->note = (float)key;
}

void WarpsCore::render(const float* carrier, const float* modulator, float* left, float* right)
{
    auto& s = *impl_;
    auto& p = *s.modulator.mutable_parameters();
    p.channel_drive[0] = params.carrierLevel;
    p.channel_drive[1] = params.modulatorLevel;
    p.modulation_algorithm = std::clamp(params.algorithm, 0.0f, 1.0f);
    p.modulation_parameter = params.timbre;
    p.carrier_shape = std::clamp(params.carrier, 0, 3);
    p.note = s.note + params.transpose + bend_;

    for (int i = 0; i < BLOCK; ++i)
        s.in[i] = {toShort(carrier != nullptr ? carrier[i] : 0.0f), toShort(modulator[i])};
    s.modulator.Process(s.in, s.out, BLOCK);
    for (int i = 0; i < BLOCK; ++i) {
        const float main = s.out[i].l / 32768.0f;
        left[i] = main;
        right[i] = params.stereo ? s.out[i].r / 32768.0f : main;
    }
}

}  // namespace studio::eurorack
