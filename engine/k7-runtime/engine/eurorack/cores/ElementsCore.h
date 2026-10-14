// ElementsCore.h — the modal synthesizer (Elements): a bow, a breath and a mallet exciting a modal
// or string resonator, with its reverb. MONOPHONIC, like the module: last note wins, and a new note
// re-strikes. The track's audio can excite it too. BLOCK frames per call at RATE. docs/eurorack.md.

#pragma once

#include <memory>

namespace studio::eurorack {

class ElementsCore {
public:
    static constexpr double RATE = 32000.0;
    static constexpr int BLOCK = 16;   // the firmware's kMaxBlockSize
    static constexpr int MODELS = 4;   // modal, string, strings, and the hidden "ominous" voice

    struct Params {
        int model = 0;
        float contour = 1.0f;
        float bowLevel = 0.0f, bowTimbre = 0.5f;
        float blowLevel = 0.0f, flow = 0.5f, blowTimbre = 0.5f;
        float strikeLevel = 0.8f, mallet = 0.5f, strikeTimbre = 0.5f;
        float geometry = 0.2f, brightness = 0.5f, damping = 0.25f, position = 0.3f, space = 0.5f;
        int input = 0;   // where the track's audio goes: 0 strike, 1 blow, 2 both
        float transpose = 0.0f;
    };

    ElementsCore();
    ~ElementsCore();

    void init();
    void noteOn(int key, float velocity);
    void noteOff(int key);
    void allNotesOff();
    void setBend(float semitones) { bend_ = semitones; }
    /** BLOCK frames; `in` is mono, and may be null. */
    void render(const float* in, float* left, float* right);

    Params params;
    static const char* modelName(int model);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float bend_ = 0.0f;
};

}  // namespace studio::eurorack
