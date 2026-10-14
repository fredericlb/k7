// CloudsCore.cpp — the only file that sees clouds::GranularProcessor. Its I/O is the codec's 16-bit
// frames, so the float signal is converted either side, clipped the way the codec would.

#include "CloudsCore.h"

#include "clouds/dsp/granular_processor.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace studio::eurorack {

namespace {

const char* const MODE_NAMES[] = {"Granular", "Stretch", "Looping delay", "Spectral"};
const char* const QUALITY_NAMES[] = {"16-bit stereo", "16-bit mono", "8-bit stereo", "8-bit mono"};
// The module's two RAM blocks, sized as in clouds.cc.
constexpr size_t LARGE = 118784;
constexpr size_t SMALL = 65536 - 128;

// The codec conversion halves the level (SoftConvert limits x * 0.5); the module's output stage makes it back.
constexpr float MAKEUP = 2.0f;

// Clamped as a FLOAT, and a NaN made silence first: lround of a NaN or of a value past `long` is undefined.
short toShort(float x) { return (short)std::lround(std::clamp(std::isfinite(x) ? x : 0.0f, -1.0f, 1.0f) * 32767.0f); }

}  // namespace

struct CloudsCore::Impl {
    clouds::GranularProcessor processor;
    std::vector<uint8_t> large = std::vector<uint8_t>(LARGE);
    std::vector<uint8_t> small = std::vector<uint8_t>(SMALL);
    clouds::ShortFrame in[BLOCK], out[BLOCK];
    int key = 60;
    int held = 0;
    bool trigger = false;
};

CloudsCore::CloudsCore() : impl_(std::make_unique<Impl>()) {}
CloudsCore::~CloudsCore() = default;

const char* CloudsCore::modeName(int m) { return m >= 0 && m < 4 ? MODE_NAMES[m] : ""; }
const char* CloudsCore::qualityName(int q) { return q >= 0 && q < 4 ? QUALITY_NAMES[q] : ""; }

void CloudsCore::init()
{
    auto& s = *impl_;
    s.processor.Init(s.large.data(), LARGE, s.small.data(), SMALL);
    // The firmware's boot order: mode and quality first, then Prepare to lay the buffers out for them.
    s.processor.set_playback_mode(clouds::PLAYBACK_MODE_GRANULAR);
    s.processor.set_quality(0);
    s.processor.Prepare();
}

void CloudsCore::noteOn(int key, float)
{
    impl_->key = key;
    impl_->trigger = true;
    ++impl_->held;
}

void CloudsCore::noteOff(int)
{
    impl_->held = std::max(0, impl_->held - 1);
}

void CloudsCore::allNotesOff()
{
    impl_->held = 0;
}

void CloudsCore::render(const float* inL, const float* inR, float* left, float* right)
{
    auto& s = *impl_;
    s.processor.set_playback_mode(static_cast<clouds::PlaybackMode>(std::clamp(params.mode, 0, 3)));
    s.processor.set_quality(std::clamp(params.quality, 0, 3));
    // What the firmware's main loop does between interrupts; it only does work when mode or quality changed.
    s.processor.Prepare();

    auto& p = *s.processor.mutable_parameters();
    p.position = params.position;
    p.size = params.size;
    const float follow = params.followNotes ? (float)(s.key - 60) : 0.0f;
    p.pitch = std::clamp(params.pitch + follow + bend_, -48.0f, 48.0f);
    p.density = params.density;
    p.texture = params.texture;
    p.dry_wet = params.dryWet;
    p.stereo_spread = params.spread;
    p.feedback = params.feedback;
    p.reverb = params.reverb;
    p.freeze = params.freeze;
    p.trigger = s.trigger;
    p.gate = s.held > 0;
    s.trigger = false;

    for (int i = 0; i < BLOCK; ++i) s.in[i] = {toShort(inL[i]), toShort(inR[i])};
    s.processor.Process(s.in, s.out, BLOCK);
    for (int i = 0; i < BLOCK; ++i) {
        left[i] = s.out[i].l * (MAKEUP / 32768.0f);
        right[i] = s.out[i].r * (MAKEUP / 32768.0f);
    }
}

}  // namespace studio::eurorack
