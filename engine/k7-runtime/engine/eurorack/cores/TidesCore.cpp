// TidesCore.cpp — the only file that sees tides::PolySlopeGenerator. Looping ramp, audio range, the
// frequency as a fraction of the module's rate: what its firmware computes from the FREQ knob.

#include "TidesCore.h"

#include "../Adsr.h"
#include "../VoiceAllocator.h"

#include "tides2/poly_slope_generator.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace studio::eurorack {

namespace {

const char* const OUTPUT_NAMES[] = {"Amplitude", "Slope/phase", "Frequency"};
// The outputs swing ±5 V and two are summed per side; 1/10 lands a voice where the other ports sit.
constexpr float VOICE_GAIN = 0.1f;

}  // namespace

struct TidesCore::Impl {
    struct Voice {
        tides::PolySlopeGenerator generator;
        Adsr env;
        int key = 60;
        float velocity = 0.0f;
    };
    std::vector<std::unique_ptr<Voice>> voices;
    VoiceAllocator<MAX_VOICES> alloc;
    stmlib::GateFlags gates[BLOCK] = {};
    tides::PolySlopeGenerator::OutputSample out[BLOCK];
};

TidesCore::TidesCore() : impl_(std::make_unique<Impl>()) {}
TidesCore::~TidesCore() = default;

const char* TidesCore::outputName(int i) { return i >= 0 && i < 3 ? OUTPUT_NAMES[i] : ""; }

void TidesCore::init()
{
    impl_->voices.clear();
    for (int v = 0; v < MAX_VOICES; ++v) {
        auto voice = std::make_unique<Impl::Voice>();
        voice->generator.Init();
        impl_->voices.push_back(std::move(voice));
    }
}

void TidesCore::noteOn(int key, float velocity)
{
    impl_->alloc.setVoices(params.voices);
    auto& v = *impl_->voices[(size_t)impl_->alloc.noteOn(key)];
    v.key = key;
    v.velocity = std::clamp(velocity, 0.0f, 1.0f);
    v.env.gateOn();
}

void TidesCore::noteOff(int key)
{
    const int v = impl_->alloc.noteOff(key);
    if (v != VoiceAllocator<MAX_VOICES>::NONE) impl_->voices[(size_t)v]->env.gateOff();
}

void TidesCore::allNotesOff()
{
    impl_->alloc.releaseAll();
    for (auto& v : impl_->voices) v->env.gateOff();
}

void TidesCore::silence()
{
    impl_->alloc.releaseAll();
    for (auto& v : impl_->voices) v->env.kill();
}

void TidesCore::render(float* left, float* right)
{
    std::fill_n(left, BLOCK, 0.0f);
    std::fill_n(right, BLOCK, 0.0f);
    // Gates mode (the module's first) is left out: its outputs are DC gate levels, not audio.
    const auto mode = static_cast<tides::OutputMode>(std::clamp(params.output, 0, 2) + 1);
    const int voices = std::clamp(params.voices, 1, MAX_VOICES);

    for (int n = 0; n < voices; ++n) {
        auto& v = *impl_->voices[(size_t)n];
        if (!v.env.active()) continue;
        v.env.set(RATE, params.attack, params.decay, params.sustain, params.release);
        const float note = (float)v.key + params.transpose + bend_;
        const float frequency = 440.0f * std::pow(2.0f, (note - 69.0f) / 12.0f) / (float)RATE;
        v.generator.Render(tides::RAMP_MODE_LOOPING, mode, tides::RANGE_AUDIO,
                           std::min(frequency, 0.25f), params.slope, params.shape,
                           params.smoothness, params.shift, impl_->gates, nullptr, impl_->out, BLOCK);
        const float level = VOICE_GAIN * (0.2f + 0.8f * v.velocity);
        for (int i = 0; i < BLOCK; ++i) {
            const float g = level * v.env.next();
            const auto& c = impl_->out[i].channel;
            left[i] += g * (c[0] + c[2]);
            right[i] += g * (c[1] + c[3]);
        }
    }
}

}  // namespace studio::eurorack
