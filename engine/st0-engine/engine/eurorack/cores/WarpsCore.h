// WarpsCore.h — the meta modulator (Warps): six cross-modulation algorithms morphing into a vocoder,
// between a CARRIER and a MODULATOR. The carrier is its internal oscillator, played by notes, or an
// external signal. BLOCK frames per call at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class WarpsCore {
public:
    // The hardware's rate. Init() takes one, but the oscillator's pitch table is normalised to this.
    static constexpr double RATE = 96000.0;
    static constexpr int BLOCK = 32;

    struct Params {
        float algorithm = 0.0f;   // 0..1: xfade, fold, analog ring, digital ring, xor, compare, vocoder
        float timbre = 0.5f;
        float carrierLevel = 0.5f, modulatorLevel = 0.5f;
        int carrier = 1;          // 0 external (the sidechain), 1..3 internal: sine, triangle, saw
        float transpose = 0.0f;
        bool stereo = false;      // true: main left, aux right; false: main on both
    };

    WarpsCore();
    ~WarpsCore();

    void init(double sampleRate);
    void noteOn(int key, float velocity);
    void noteOff(int) {}   // the oscillator runs on; the modulator is what shapes the level
    void allNotesOff() {}
    void setBend(float semitones) { bend_ = semitones; }
    void render(const float* carrier, const float* modulator, float* left, float* right);

    Params params;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
