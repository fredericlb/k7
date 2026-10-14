// PlaitsCore.cpp — the only file that sees plaits::Voice. One firmware voice per note, each with the
// 16 KB of RAM its engines share on the module, and a trigger + level pair standing in for GATE and
// the LEVEL input, which is how the module's low-pass gate is played from a keyboard.

#include "PlaitsCore.h"

#include "../VoiceAllocator.h"

#include "plaits/dsp/voice.h"
#include "stmlib/utils/buffer_allocator.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace studio::eurorack {

namespace {

constexpr size_t RAM = 16384;
// Past this long below the floor after its release, a voice stops being computed until its next note.
constexpr int IDLE_BLOCKS = (int)(0.25 * PlaitsCore::RATE / PlaitsCore::BLOCK);
constexpr float IDLE_FLOOR = 1.0e-4f;
// Each voice at -6 dB, so a chord of full-scale voices has room before the mixer.
constexpr float VOICE_GAIN = 0.5f / 32768.0f;

const char* const NAMES[PlaitsCore::ENGINES] = {
    "VA + filter", "Phase distortion", "6-op FM 1", "6-op FM 2", "6-op FM 3", "Wave terrain",
    "String machine", "Chiptune", "Virtual analog", "Waveshaping", "2-op FM", "Granular formant",
    "Harmonic", "Wavetable", "Chords", "Speech", "Swarm", "Filtered noise", "Particle noise",
    "Inharmonic string", "Modal resonator", "Bass drum", "Snare drum", "Hi-hat"};

}  // namespace

struct PlaitsCore::Impl {
    struct Slot {
        plaits::Voice voice;
        char ram[RAM];
        float note = 60.0f;
        float velocity = 0.0f;
        bool gate = false;
        int lowBlocks = 0;   // a retrigger needs the trigger LOW for a block before it rises again
        int idle = IDLE_BLOCKS;
    };
    std::vector<std::unique_ptr<Slot>> slots;
    VoiceAllocator<MAX_VOICES> alloc;
    plaits::Voice::Frame frames[BLOCK];
};

PlaitsCore::PlaitsCore() : impl_(std::make_unique<Impl>()) {}
PlaitsCore::~PlaitsCore() = default;

const char* PlaitsCore::engineName(int engine)
{
    return engine >= 0 && engine < ENGINES ? NAMES[engine] : "";
}

void PlaitsCore::init()
{
    impl_->slots.clear();
    for (int v = 0; v < MAX_VOICES; ++v) {
        auto s = std::make_unique<Impl::Slot>();
        stmlib::BufferAllocator allocator(s->ram, RAM);
        s->voice.Init(&allocator);
        impl_->slots.push_back(std::move(s));
    }
}

void PlaitsCore::noteOn(int key, float velocity)
{
    impl_->alloc.setVoices(params.voices);
    auto& s = *impl_->slots[(size_t)impl_->alloc.noteOn(key)];
    if (s.gate) s.lowBlocks = 1;
    s.note = (float)key;
    s.velocity = std::clamp(velocity, 0.0f, 1.0f);
    s.gate = true;
    s.idle = 0;
}

void PlaitsCore::noteOff(int key)
{
    const int v = impl_->alloc.noteOff(key);
    if (v != VoiceAllocator<MAX_VOICES>::NONE) impl_->slots[(size_t)v]->gate = false;
}

void PlaitsCore::allNotesOff()
{
    impl_->alloc.releaseAll();
    for (auto& s : impl_->slots) s->gate = false;
}

void PlaitsCore::silence()
{
    impl_->alloc.releaseAll();
    // An idle voice is not rendered at all, so its decaying LPG stops here.
    for (auto& s : impl_->slots) {
        s->gate = false;
        s->lowBlocks = 0;
        s->idle = IDLE_BLOCKS;
    }
}

void PlaitsCore::render(float* left, float* right)
{
    std::fill_n(left, BLOCK, 0.0f);
    std::fill_n(right, BLOCK, 0.0f);
    if (impl_->slots.empty()) return;

    plaits::Patch patch{};
    patch.harmonics = params.harmonics;
    patch.timbre = params.timbre;
    patch.morph = params.morph;
    patch.frequency_modulation_amount = params.pitchEnv;
    patch.timbre_modulation_amount = params.timbreEnv;
    patch.morph_modulation_amount = params.morphEnv;
    patch.engine = std::clamp(params.engine, 0, ENGINES - 1);
    patch.decay = params.decay;
    patch.lpg_colour = params.colour;

    plaits::Modulations mod{};
    mod.trigger_patched = true;
    mod.level_patched = !params.ping;

    const int voices = std::clamp(params.voices, 1, MAX_VOICES);
    for (int v = 0; v < voices; ++v) {
        auto& s = *impl_->slots[(size_t)v];
        if (!s.gate && s.idle >= IDLE_BLOCKS) continue;

        patch.note = s.note + params.transpose + bend_;
        const bool high = s.gate && s.lowBlocks == 0;
        if (s.lowBlocks > 0) --s.lowBlocks;
        mod.trigger = high ? 1.0f : 0.0f;
        // LEVEL, as the module reads it: the velocity while held, 0 after — the gate's tail is the decay's.
        mod.level = s.gate ? 0.2f + 0.8f * s.velocity : 0.0f;
        s.voice.Render(patch, mod, impl_->frames, BLOCK);

        float peak = 0.0f;
        for (int i = 0; i < BLOCK; ++i) {
            const float out = impl_->frames[i].out * VOICE_GAIN;
            const float aux = impl_->frames[i].aux * VOICE_GAIN;
            const float l = params.output == 1 ? aux : out;
            const float r = params.output == 0 ? out : aux;
            left[i] += l;
            right[i] += r;
            peak = std::max(peak, std::max(std::abs(l), std::abs(r)));
        }
        s.idle = (!s.gate && peak < IDLE_FLOOR) ? s.idle + 1 : 0;
    }
}

}  // namespace studio::eurorack
