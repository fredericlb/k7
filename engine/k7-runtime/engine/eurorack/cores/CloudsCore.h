// CloudsCore.h — the texture synthesizer (Clouds): a granular, stretching, looping-delay and
// spectral processor over a recording buffer, stereo in and out. A note fires a grain (the module's
// TRIG) and may shift the pitch. BLOCK frames per call at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class CloudsCore {
public:
    static constexpr double RATE = 32000.0;
    static constexpr int BLOCK = 32;   // the firmware's kMaxBlockSize

    struct Params {
        int mode = 0;      // granular, stretch, looping delay, spectral
        int quality = 0;   // 16-bit stereo, 16-bit mono, 8-bit stereo, 8-bit mono
        float position = 0.5f, size = 0.5f, pitch = 0.0f, density = 0.5f, texture = 0.5f;
        float dryWet = 0.5f, spread = 0.5f, feedback = 0.0f, reverb = 0.0f;
        bool freeze = false;
        bool followNotes = false;   // a note's distance from C4 adds to the pitch
    };

    CloudsCore();
    ~CloudsCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int key);
    void allNotesOff();
    void setBend(float semitones) { bend_ = semitones; }
    void render(const float* inL, const float* inR, float* left, float* right);

    Params params;
    static const char* modeName(int mode);
    static const char* qualityName(int quality);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
