// ElementsCore.cpp — the only file that sees elements::Part. The inputs' noise gates are the
// firmware's (elements.cc); the note stack and the retrigger are ours, since the module has a GATE.

#include "ElementsCore.h"

#include "elements/dsp/part.h"

#include <algorithm>
#include <cmath>

namespace studio::eurorack {

namespace {

const char* const MODEL_NAMES[ElementsCore::MODELS] = {"Modal", "String", "Strings", "Ominous"};
constexpr float NOISE_GATE = 0.0001f;
constexpr int STACK = 16;
// The module runs hot and soft-clips into its 16-bit codec; -6 dB leaves that headroom here instead.
constexpr float OUTPUT_GAIN = 0.5f;

// The firmware's gate on an exciter input: silence below the threshold, so hiss does not ring the resonator.
struct Gate {
    float level = 0.0f;
    float operator()(float x)
    {
        const float error = x * x - level;
        level += error * (error > 0.0f ? 0.1f : 0.0001f);
        return (level <= NOISE_GATE ? level / NOISE_GATE : 1.0f) * x;
    }
};

}  // namespace

struct ElementsCore::Impl {
    elements::Part part;
    uint16_t reverb[32768];   // the module's CCM, as in RingsCore
    int stack[STACK];         // held keys, the last one sounding
    int held = 0;
    float velocity = 0.8f;
    bool retrigger = false;   // a new note over a held one: the gate drops for one block first
    Gate strikeGate, blowGate;
    float strike[BLOCK], blow[BLOCK], out[BLOCK], aux[BLOCK];
};

ElementsCore::ElementsCore() : impl_(std::make_unique<Impl>()) {}
ElementsCore::~ElementsCore() = default;

const char* ElementsCore::modelName(int m) { return m >= 0 && m < MODELS ? MODEL_NAMES[m] : ""; }

void ElementsCore::init()
{
    impl_->part.Init(impl_->reverb);
    // The firmware seeds from the chip's unique id; a fixed seed makes a render repeatable instead.
    uint32_t seed[3] = {0x5eed0001u, 0x5eed0002u, 0x5eed0003u};
    impl_->part.Seed(seed, 3);
}

void ElementsCore::noteOn(int key, float velocity)
{
    auto& s = *impl_;
    // A key already down moves to the top rather than appearing twice.
    s.held = (int)(std::remove(s.stack, s.stack + s.held, key) - s.stack);
    if (s.held == STACK) {
        std::copy(s.stack + 1, s.stack + STACK, s.stack);
        --s.held;
    }
    if (s.held > 0) s.retrigger = true;
    s.stack[s.held++] = key;
    s.velocity = std::clamp(velocity, 0.0f, 1.0f);
}

void ElementsCore::noteOff(int key)
{
    auto& s = *impl_;
    // Back to the previous held key WITHOUT a re-strike: a legato release, as on a mono synth.
    s.held = (int)(std::remove(s.stack, s.stack + s.held, key) - s.stack);
}

void ElementsCore::allNotesOff()
{
    impl_->held = 0;
    impl_->retrigger = false;
}

void ElementsCore::render(const float* in, float* left, float* right)
{
    auto& s = *impl_;
    auto& patch = *s.part.mutable_patch();
    patch.exciter_envelope_shape = params.contour;
    patch.exciter_bow_level = params.bowLevel;
    patch.exciter_bow_timbre = params.bowTimbre;
    patch.exciter_blow_level = params.blowLevel;
    patch.exciter_blow_meta = params.flow;
    patch.exciter_blow_timbre = params.blowTimbre;
    patch.exciter_strike_level = params.strikeLevel;
    patch.exciter_strike_meta = params.mallet;
    patch.exciter_strike_timbre = params.strikeTimbre;
    patch.resonator_geometry = params.geometry;
    patch.resonator_brightness = params.brightness;
    patch.resonator_damping = params.damping;
    patch.resonator_position = params.position;
    patch.space = params.space;

    const int model = std::clamp(params.model, 0, MODELS - 1);
    s.part.set_easter_egg(model == 3);
    if (model < 3) s.part.set_resonator_model(static_cast<elements::ResonatorModel>(model));

    for (int i = 0; i < BLOCK; ++i) {
        const float x = in != nullptr ? in[i] : 0.0f;
        s.strike[i] = s.strikeGate(params.input != 1 ? x : 0.0f);
        s.blow[i] = s.blowGate(params.input != 0 ? x : 0.0f);
    }

    elements::PerformanceState ps{};
    ps.gate = s.held > 0 && !s.retrigger;
    s.retrigger = false;
    ps.note = (s.held > 0 ? (float)s.stack[s.held - 1] : 60.0f) + params.transpose + bend_;
    ps.modulation = 0.0f;
    ps.strength = 0.2f + 0.8f * s.velocity;
    s.part.Process(ps, s.blow, s.strike, s.out, s.aux, BLOCK);

    // The module's own wiring: AUX is its left output, MAIN its right.
    for (int i = 0; i < BLOCK; ++i) {
        left[i] = s.aux[i] * OUTPUT_GAIN;
        right[i] = s.out[i] * OUTPUT_GAIN;
    }
}

}  // namespace studio::eurorack
