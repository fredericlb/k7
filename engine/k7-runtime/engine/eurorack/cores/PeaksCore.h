// PeaksCore.h — the drum voices of the dual trigger converter (Peaks): an 808-style kick, snare and
// hi-hat and an FM drum, each struck by its own General MIDI note. Only the drums: the rest of the
// module makes envelopes and LFOs, which have nothing to plug into here. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class PeaksCore {
public:
    static constexpr double RATE = 48000.0;   // each DAC channel's rate, the timer alternating two
    static constexpr int BLOCK = 16;          // the drums run per sample: any size is exact

    struct Params {
        float kickPitch = 0.5f, kickPunch = 0.6f, kickTone = 0.5f, kickDecay = 0.5f;
        float snarePitch = 0.5f, snareTone = 0.5f, snareSnappy = 0.5f, snareDecay = 0.5f;
        float fmPitch = 0.5f, fmAmount = 0.5f, fmDecay = 0.5f, fmNoise = 0.2f;
    };

    PeaksCore();
    ~PeaksCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int) {}   // a drum is struck, never held
    void allNotesOff() {}
    void setBend(float) {}
    void render(float* left, float* right);

    Params params;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace studio::eurorack
