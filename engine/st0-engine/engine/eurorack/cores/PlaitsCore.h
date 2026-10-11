// PlaitsCore.h — the macro oscillator 2 (Plaits' voice) as N polyphonic voices driven by notes.
// JUCE-free and free of the firmware's headers too: stmlib #defines NULL, CLIP and SLOPE, so those
// stay inside PlaitsCore.cpp. Renders exactly BLOCK frames per call, at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class PlaitsCore {
public:
    static constexpr double RATE = 48000.0;
    static constexpr int BLOCK = 12;   // Plaits' kBlockSize: its envelopes advance once per call
    static constexpr int MAX_VOICES = 8;
    static constexpr int ENGINES = 24;

    struct Params {
        int engine = 8;             // virtual analog: the first of the original sixteen
        float harmonics = 0.5f, timbre = 0.5f, morph = 0.5f;
        float pitchEnv = 0.0f, timbreEnv = 0.0f, morphEnv = 0.0f;   // -1..1, the internal decay's depth
        float decay = 0.5f, colour = 0.5f;
        bool ping = false;          // true: the gate is STRUCK and decays; false: it follows the held note
        float transpose = 0.0f;     // semitones
        int output = 0;             // 0 main, 1 aux, 2 main left / aux right
        int voices = 8;
    };

    PlaitsCore();
    ~PlaitsCore();

    /** Allocates every voice; call once, off the audio thread. */
    void init();
    void noteOn(int key, float velocity);
    void noteOff(int key);
    void allNotesOff();
    /** Every voice cut, not released: what a seek asks for. Audio thread, allocation-free. */
    void silence();
    void setBend(float semitones) { bend_ = semitones; }

    /** BLOCK frames into two channels, with `params` as they stand. */
    void render(float* left, float* right);

    Params params;
    static const char* engineName(int engine);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
