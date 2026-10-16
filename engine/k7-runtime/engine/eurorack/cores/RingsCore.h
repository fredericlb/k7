// RingsCore.h — the resonator (Rings): modal, sympathetic-string, string and FM models, plus the
// string synth hidden in its firmware. A note tunes and STRUMS it; the input excites it. Its voices
// are its own (1, 2 or 4): a strum moves to the next and lets the last ring. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class RingsCore {
public:
    static constexpr double RATE = 48000.0;
    static constexpr int BLOCK = 24;    // the firmware's kMaxBlockSize, which is what it runs
    static constexpr int MODELS = 12;   // six resonator models, then the string synth with each of its six effects

    struct Params {
        int model = 0;
        int polyphony = 0;   // index into 1, 2, 4: one voice, the module's own default
        float structure = 0.5f, brightness = 0.5f, damping = 0.5f, position = 0.5f;
        bool internalExciter = true;
        float transpose = 0.0f;
        float glide = 0.0f;   // seconds the pitch takes to settle on a new note; 0 jumps, as the module does
    };

    RingsCore();
    ~RingsCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int) {}   // a strummed string has no note-off: it rings until damped
    void allNotesOff() {}
    void setBend(float semitones) { bend_ = semitones; }
    /** BLOCK frames: `in` is the exciter (mono), out left = odd strings, right = even. */
    void render(const float* in, float* left, float* right);

    Params params;
    static const char* modelName(int model);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
