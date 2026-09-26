// PeaksCore.cpp — the only file that sees the peaks drums. Each takes its four "expert mode"
// parameters as 16-bit words and a gate as per-sample flags; a note is one sample of RISING.

#include "PeaksCore.h"

#include "peaks/drums/bass_drum.h"
#include "peaks/drums/fm_drum.h"
#include "peaks/drums/high_hat.h"
#include "peaks/drums/snare_drum.h"

#include <algorithm>

namespace studio::eurorack {

namespace {

enum Drum { KICK, SNARE, HAT, FM, DRUMS };
// Each drum at -6 dB, as the other ports' voices, so the four together have room.
constexpr float DRUM_GAIN = 0.5f / 32768.0f;

// The General MIDI drum map, folded onto four voices: everything that is not a kick, snare or hat is a tom.
Drum drumFor(int key)
{
    if (key == 35 || key == 36) return KICK;
    if (key >= 37 && key <= 40) return SNARE;
    if (key == 42 || key == 44 || key == 46) return HAT;
    return FM;
}

uint16_t word(float x) { return (uint16_t)(std::clamp(x, 0.0f, 1.0f) * 65535.0f); }

}  // namespace

struct PeaksCore::Impl {
    peaks::BassDrum kick;
    peaks::SnareDrum snare;
    peaks::HighHat hat;
    peaks::FmDrum fm;
    bool strike[DRUMS] = {};
    float level[DRUMS] = {1, 1, 1, 1};
    peaks::GateFlags gates[BLOCK];
    int16_t out[BLOCK];
};

PeaksCore::PeaksCore() : impl_(std::make_unique<Impl>()) {}
PeaksCore::~PeaksCore() = default;

void PeaksCore::init()
{
    impl_->kick.Init();
    impl_->snare.Init();
    impl_->hat.Init();
    impl_->fm.Init();
}

void PeaksCore::noteOn(int key, float velocity)
{
    const Drum d = drumFor(key);
    impl_->strike[d] = true;
    impl_->level[d] = 0.2f + 0.8f * std::clamp(velocity, 0.0f, 1.0f);
}

void PeaksCore::render(float* left, float* right)
{
    auto& s = *impl_;
    uint16_t kick[4] = {word(params.kickPitch), word(params.kickPunch), word(params.kickTone), word(params.kickDecay)};
    uint16_t snare[4] = {word(params.snarePitch), word(params.snareTone), word(params.snareSnappy),
                         word(params.snareDecay)};
    uint16_t fm[4] = {word(params.fmPitch), word(params.fmAmount), word(params.fmDecay), word(params.fmNoise)};
    s.kick.Configure(kick, peaks::CONTROL_MODE_FULL);
    s.snare.Configure(snare, peaks::CONTROL_MODE_FULL);
    s.fm.Configure(fm, peaks::CONTROL_MODE_FULL);

    std::fill_n(left, BLOCK, 0.0f);
    const auto run = [&](Drum d, auto& drum) {
        // A strike is RISING on the block's first sample; the rest of the block is the gate held low.
        std::fill_n(s.gates, BLOCK, peaks::GATE_FLAG_LOW);
        if (s.strike[d]) s.gates[0] = peaks::GATE_FLAG_RISING | peaks::GATE_FLAG_HIGH;
        s.strike[d] = false;
        drum.Process(s.gates, s.out, BLOCK);
        const float g = DRUM_GAIN * s.level[d];
        for (int i = 0; i < BLOCK; ++i) left[i] += s.out[i] * g;
    };
    run(KICK, s.kick);
    run(SNARE, s.snare);
    run(HAT, s.hat);
    run(FM, s.fm);
    std::copy_n(left, BLOCK, right);
}

}  // namespace studio::eurorack
