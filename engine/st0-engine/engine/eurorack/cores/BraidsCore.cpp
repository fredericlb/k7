// BraidsCore.cpp — the only file that sees braids::MacroOscillator. The bit and rate reduction are
// the firmware's own, from its render loop (braids.cc), since they are half of this module's sound.

#include "BraidsCore.h"

#include "../Adsr.h"
#include "../VoiceAllocator.h"

#include "braids/macro_oscillator.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace studio::eurorack {

namespace {

const char* const SHAPE_NAMES[BraidsCore::SHAPES] = {
    "CSaw", "Morph", "Saw/square", "Fold", "Buzz", "Square sub", "Saw sub", "Square sync",
    "Saw sync", "Triple saw", "Triple square", "Triple triangle", "Triple sine", "Ring mod",
    "Saw swarm", "Saw comb", "Toy", "Digital LPF", "Digital peak", "Digital BPF", "Digital HPF",
    "Vosim", "Vowel", "Vowel FOF", "Harmonics", "FM", "Feedback FM", "Chaotic FM", "Plucked",
    "Bowed", "Blown", "Fluted", "Struck bell", "Struck drum", "Kick", "Cymbal", "Snare",
    "Wavetables", "Wave map", "Wave line", "Paraphonic", "Filtered noise", "Twin peaks noise",
    "Clocked noise", "Granular cloud", "Particle noise", "Digital modulation"};
const char* const BIT_NAMES[] = {"2 bits", "3 bits", "4 bits", "6 bits", "8 bits", "12 bits", "16 bits"};
const char* const RATE_NAMES[] = {"4 kHz", "8 kHz", "16 kHz", "24 kHz", "32 kHz", "48 kHz", "96 kHz"};
const uint16_t MASKS[] = {0xc000, 0xe000, 0xf000, 0xf800, 0xff00, 0xfff0, 0xffff};
const int DECIMATION[] = {24, 12, 6, 4, 3, 2, 1};
// Each voice at -6 dB, as in PlaitsCore, so a chord has room.
constexpr float VOICE_GAIN = 0.5f / 32768.0f;

}  // namespace

struct BraidsCore::Impl {
    struct Voice {
        braids::MacroOscillator osc;
        Adsr env;
        int key = 60;
        float velocity = 0.0f;
        int16_t held = 0;   // the sample-and-hold of the rate reduction
    };
    std::vector<std::unique_ptr<Voice>> voices;
    VoiceAllocator<MAX_VOICES> alloc;
    uint8_t sync[BLOCK] = {};
    int16_t buffer[BLOCK] = {};
    float gain[BLOCK] = {};
};

BraidsCore::BraidsCore() : impl_(std::make_unique<Impl>()) {}
BraidsCore::~BraidsCore() = default;

const char* BraidsCore::shapeName(int s) { return s >= 0 && s < SHAPES ? SHAPE_NAMES[s] : ""; }
const char* BraidsCore::bitsName(int i) { return i >= 0 && i < 7 ? BIT_NAMES[i] : ""; }
const char* BraidsCore::rateName(int i) { return i >= 0 && i < 7 ? RATE_NAMES[i] : ""; }

void BraidsCore::init()
{
    impl_->voices.clear();
    for (int v = 0; v < MAX_VOICES; ++v) {
        auto voice = std::make_unique<Impl::Voice>();
        voice->osc.Init();
        impl_->voices.push_back(std::move(voice));
    }
}

void BraidsCore::noteOn(int key, float velocity)
{
    impl_->alloc.setVoices(params.voices);
    auto& v = *impl_->voices[(size_t)impl_->alloc.noteOn(key)];
    v.key = key;
    v.velocity = std::clamp(velocity, 0.0f, 1.0f);
    // A struck model (pluck, drums, bell) restarts its excitation here, as the module's TRIG input does.
    v.osc.Strike();
    v.env.gateOn();
}

void BraidsCore::noteOff(int key)
{
    const int v = impl_->alloc.noteOff(key);
    if (v != VoiceAllocator<MAX_VOICES>::NONE) impl_->voices[(size_t)v]->env.gateOff();
}

void BraidsCore::allNotesOff()
{
    impl_->alloc.releaseAll();
    for (auto& v : impl_->voices) v->env.gateOff();
}

void BraidsCore::render(float* left, float* right)
{
    std::fill_n(left, BLOCK, 0.0f);
    std::fill_n(right, BLOCK, 0.0f);
    if (impl_->voices.empty()) return;

    const auto shape = static_cast<braids::MacroOscillatorShape>(std::clamp(params.shape, 0, SHAPES - 1));
    const uint16_t mask = MASKS[std::clamp(params.bits, 0, 6)];
    const int decimation = DECIMATION[std::clamp(params.rate, 0, 6)];
    const int voices = std::clamp(params.voices, 1, MAX_VOICES);

    for (int n = 0; n < voices; ++n) {
        auto& v = *impl_->voices[(size_t)n];
        if (!v.env.active()) continue;
        v.env.set(RATE, params.attack, params.decay, params.sustain, params.release);
        for (int i = 0; i < BLOCK; ++i) impl_->gain[i] = v.env.next();

        // The envelope reaches TIMBRE and COLOR once per block, as the module's AD does.
        const float e = impl_->gain[BLOCK - 1];
        const auto param = [e](float base, float depth) {
            return (int16_t)std::clamp((base + depth * e) * 32767.0f, 0.0f, 32767.0f);
        };
        v.osc.set_shape(shape);
        v.osc.set_parameters(param(params.timbre, params.timbreEnv), param(params.color, params.colorEnv));
        // Pitch in 1/128 semitone, MIDI numbering: what the firmware's quantizer hands the oscillator.
        const float note = (float)v.key + params.transpose + bend_;
        v.osc.set_pitch((int16_t)std::clamp(note * 128.0f, 0.0f, 16383.0f));

        std::memset(impl_->sync, 0, sizeof(impl_->sync));
        v.osc.Render(impl_->sync, impl_->buffer, BLOCK);

        const float level = VOICE_GAIN * (0.2f + 0.8f * v.velocity);
        for (int i = 0; i < BLOCK; ++i) {
            if (i % decimation == 0) v.held = (int16_t)(impl_->buffer[i] & mask);
            const float s = v.held * level * impl_->gain[i];
            left[i] += s;
            right[i] += s;
        }
    }
}

}  // namespace studio::eurorack
