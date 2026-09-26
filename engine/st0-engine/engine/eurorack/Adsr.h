// Adsr.h — the amplitude envelope a module without one gets when it is played from a keyboard:
// a linear attack, exponential decay and release. Per sample, so a 1 ms attack is 1 ms at any core
// rate. JUCE-free and header-only, so tests/ covers it in the FAST binary.

#pragma once

#include <algorithm>
#include <cmath>

namespace studio::eurorack {

class Adsr {
public:
    enum class Stage { idle, attack, decay, sustain, release };

    /** Times in seconds; they apply from the next sample, so a knob moves a running envelope. */
    void set(double rate, float attack, float decay, float sustain, float release)
    {
        attackStep_ = 1.0f / (float)std::max(1.0, attack * rate);
        decayCoef_ = coef(rate, decay);
        releaseCoef_ = coef(rate, release);
        sustain_ = std::clamp(sustain, 0.0f, 1.0f);
    }

    void gateOn() { stage_ = Stage::attack; }
    void gateOff()
    {
        if (stage_ != Stage::idle) stage_ = Stage::release;
    }
    void kill()
    {
        stage_ = Stage::idle;
        value_ = 0.0f;
    }

    float next()
    {
        switch (stage_) {
            case Stage::attack:
                value_ += attackStep_;
                if (value_ >= 1.0f) {
                    value_ = 1.0f;
                    stage_ = Stage::decay;
                }
                break;
            case Stage::decay:
                value_ = sustain_ + (value_ - sustain_) * decayCoef_;
                if (value_ - sustain_ < 1.0e-4f) stage_ = Stage::sustain;
                break;
            case Stage::sustain: value_ = sustain_; break;
            case Stage::release:
                value_ *= releaseCoef_;
                if (value_ < 1.0e-5f) kill();
                break;
            case Stage::idle: break;
        }
        return value_;
    }

    bool active() const { return stage_ != Stage::idle; }
    Stage stage() const { return stage_; }

private:
    // The per-sample factor that takes a level to -80 dB in `seconds`: "time" means to silence, not to 1/e.
    static float coef(double rate, float seconds)
    {
        const double n = std::max(1.0, (double)seconds * rate);
        return (float)std::exp(std::log(1.0e-4) / n);
    }

    Stage stage_ = Stage::idle;
    float value_ = 0.0f;
    float attackStep_ = 1.0f, decayCoef_ = 0.999f, releaseCoef_ = 0.999f, sustain_ = 1.0f;
};

}  // namespace studio::eurorack
