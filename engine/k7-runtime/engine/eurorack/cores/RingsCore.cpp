// RingsCore.cpp — the only file that sees rings::Part. The input's noise gate is the firmware's own
// (rings.cc), since the resonator otherwise rings on hiss; the rest is what its cv_scaler does.

#include "RingsCore.h"

#include "rings/dsp/part.h"
#include "rings/dsp/string_synth_part.h"
#include "rings/dsp/strummer.h"

#include <algorithm>
#include <cmath>

namespace studio::eurorack {

namespace {

const char* const MODEL_NAMES[RingsCore::MODELS] = {
    "Modal", "Sympathetic strings", "String", "FM voice", "Sympathetic quantized",
    "String + reverb", "Synth: formant", "Synth: chorus", "Synth: reverb", "Synth: formant 2",
    "Synth: ensemble", "Synth: reverb 2"};
const int POLYPHONY[] = {1, 2, 4};
constexpr float NOISE_GATE = 0.00003f;
// The firmware's tonic with its FREQUENCY knob at zero; a note is then played above it.
constexpr float TONIC = 12.0f;
// The strummer ignores a strum within 10 ms of the last, so notes wait their turn: a chord is STRUMMED.
constexpr int STRUM_GAP = (int)(0.0105 * RingsCore::RATE / RingsCore::BLOCK) + 1;
constexpr int QUEUE = 8;

}  // namespace

struct RingsCore::Impl {
    rings::Part part;
    rings::StringSynthPart synth;
    rings::Strummer strummer;
    uint16_t reverb[32768];   // the module's 64 KB of CCM, shared by both parts as on the hardware
    float note = 69.0f;
    // The pitch the firmware is HANDED, slewed towards `note`; NaN until the first strum, which never glides.
    float pitch = std::nanf("");
    int queue[QUEUE];
    int queued = 0;
    int cooldown = 0;
    // What each part was last told: its setters re-initialise every resonator, so they are called on CHANGE only.
    int partPoly = -1, partModel = -1, synthPoly = -1, synthFx = -1;
    float inLevel = 0.0f;
    float gated[BLOCK];
};

RingsCore::RingsCore() : impl_(std::make_unique<Impl>()) {}
RingsCore::~RingsCore() = default;

const char* RingsCore::modelName(int m) { return m >= 0 && m < MODELS ? MODEL_NAMES[m] : ""; }

void RingsCore::init()
{
    impl_->strummer.Init(0.01f, rings::kSampleRate / rings::kMaxBlockSize);
    impl_->part.Init(impl_->reverb);
    impl_->synth.Init(impl_->reverb);
}

void RingsCore::noteOn(int key, float)
{
    // Past eight waiting notes the oldest is dropped: a burst that long is not a chord any more.
    auto& s = *impl_;
    if (s.queued == QUEUE) {
        std::copy(s.queue + 1, s.queue + QUEUE, s.queue);
        --s.queued;
    }
    s.queue[s.queued++] = key;
}

void RingsCore::render(const float* in, float* left, float* right)
{
    auto& s = *impl_;
    for (int i = 0; i < BLOCK; ++i) {
        const float x = in != nullptr ? in[i] : 0.0f;
        const float error = x * x - s.inLevel;
        s.inLevel += error * (error > 0.0f ? 0.1f : 0.0001f);
        s.gated[i] = (s.inLevel <= NOISE_GATE ? s.inLevel / NOISE_GATE : 1.0f) * x;
    }

    rings::Patch patch{params.structure, params.brightness, params.damping, params.position};
    rings::PerformanceState ps{};
    ps.internal_exciter = params.internalExciter;
    ps.internal_strum = false;   // strums come from notes, never from the onset detector
    ps.internal_note = false;
    bool strum = false;
    if (s.cooldown > 0) --s.cooldown;
    if (s.cooldown == 0 && s.queued > 0) {
        s.note = (float)s.queue[0];
        std::copy(s.queue + 1, s.queue + s.queued, s.queue);
        --s.queued;
        s.cooldown = STRUM_GAP;
        strum = true;
    }
    // A one-pole slew per block: `glide` is its time constant, and the strummed voice follows it (docs/eurorack.md).
    if (params.glide <= 0.0f || std::isnan(s.pitch))
        s.pitch = s.note;
    else
        s.pitch += (s.note - s.pitch) * (1.0f - std::exp(-(float)BLOCK / ((float)RATE * params.glide)));
    ps.tonic = TONIC;
    ps.note = s.pitch + params.transpose + bend_ - TONIC;
    ps.fm = 0.0f;
    ps.strum = strum;
    // STRUCTURE picks the chord, with no hysteresis: a parameter here does not jitter the way a pot does.
    ps.chord = std::clamp((int)std::lround(params.structure * (rings::kNumChords - 1)), 0,
                          (int)rings::kNumChords - 1);

    const int poly = POLYPHONY[std::clamp(params.polyphony, 0, 2)];
    s.strummer.Process(nullptr, BLOCK, &ps);
    if (params.model < 6) {
        if (poly != s.partPoly) s.part.set_polyphony(s.partPoly = poly);
        if (params.model != s.partModel)
            s.part.set_model(static_cast<rings::ResonatorModel>(s.partModel = params.model));
        s.part.Process(ps, patch, s.gated, left, right, BLOCK);
    } else {
        if (poly != s.synthPoly) s.synth.set_polyphony(s.synthPoly = poly);
        if (params.model - 6 != s.synthFx)
            s.synth.set_fx(static_cast<rings::FxType>(s.synthFx = params.model - 6));
        s.synth.Process(ps, patch, s.gated, left, right, BLOCK);
    }
}

}  // namespace studio::eurorack
