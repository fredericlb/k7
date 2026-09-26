// TidesCore.h — the tidal modulator 2 (Tides 2) at audio rate: a looping slope generator whose
// SHAPE, SLOPE and SMOOTHNESS sculpt the wave and SHIFT spreads it over four outputs, mixed to two.
// N voices, each with an ADSR. BLOCK frames per call at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class TidesCore {
public:
    static constexpr double RATE = 62500.0;   // the module's DAC rate
    static constexpr int BLOCK = 8;           // its kBlockSize
    static constexpr int MAX_VOICES = 8;

    struct Params {
        int output = 2;   // index into amplitude, slope/phase, frequency: what SHIFT spreads
        float shape = 0.5f, slope = 0.5f, smoothness = 0.5f, shift = 0.3f;
        float attack = 0.002f, decay = 0.3f, sustain = 0.8f, release = 0.3f;
        float transpose = 0.0f;
        int voices = 8;
    };

    TidesCore();
    ~TidesCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int key);
    void allNotesOff();
    void setBend(float semitones) { bend_ = semitones; }
    void render(float* left, float* right);

    Params params;
    static const char* outputName(int i);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
