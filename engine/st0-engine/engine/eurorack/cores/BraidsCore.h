// BraidsCore.h — the macro oscillator (Braids' 47 shapes) as N voices, each with an ADSR: the
// module is an oscillator and nothing else, so a keyboard needs the envelope it does not have.
// JUCE-free, firmware headers kept inside the .cpp. BLOCK frames per call at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class BraidsCore {
public:
    static constexpr double RATE = 96000.0;
    static constexpr int BLOCK = 24;   // the firmware's kBlockSize
    static constexpr int MAX_VOICES = 8;
    static constexpr int SHAPES = 47;  // every shape but the easter egg

    struct Params {
        int shape = 0;
        float timbre = 0.5f, color = 0.5f;
        float attack = 0.002f, decay = 0.3f, sustain = 0.8f, release = 0.3f;   // seconds, and a level
        float timbreEnv = 0.0f, colorEnv = 0.0f;   // how far the envelope pushes each, 0..1
        int bits = 6;     // index into 2,3,4,6,8,12,16 bits
        int rate = 6;     // index into 4k,8k,16k,24k,32k,48k,96k: a sample-and-hold, as on the module
        float transpose = 0.0f;
        int voices = 8;
    };

    BraidsCore();
    ~BraidsCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int key);
    void allNotesOff();
    void setBend(float semitones) { bend_ = semitones; }
    void render(float* left, float* right);

    Params params;
    static const char* shapeName(int shape);
    static const char* bitsName(int i);
    static const char* rateName(int i);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
