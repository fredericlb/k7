// Biquad.h — juce::IIRFilter's arithmetic, operation for operation, without its lock: that class takes a SpinLock on
// every setCoefficients and every processSamples, on the audio thread. Output is bit-identical (docs/audit-stabilite.md).
// The one thing a reader would get wrong: it is for ONE thread — every call here is the audio thread's, which is what lets it drop the lock.

#pragma once

#include <tracktion_engine/tracktion_engine.h>   // JUCE, as every engine header takes it

namespace studio {

// JUCE_SNAP_TO_ZERO as JUCE defines it — a snap on Intel, nothing on ARM — spelled out, since the macro names an unqualified juce function.
inline void snapToZero(float& n) noexcept {
#if JUCE_INTEL
    if (!(n < -1.0e-8f || n > 1.0e-8f)) n = 0;
#else
    juce::ignoreUnused(n);
#endif
}

class Biquad {
public:
    // Inactive until given coefficients, as juce::IIRFilter is: a block through it is left untouched.
    void setCoefficients(const juce::IIRCoefficients& c) noexcept {
        coefficients = c;
        active = true;
    }

    void reset() noexcept { v1 = v2 = 0.0f; }

    float processSingleSampleRaw(float in) noexcept {
        auto out = coefficients.coefficients[0] * in + v1;
        snapToZero(out);
        v1 = coefficients.coefficients[1] * in - coefficients.coefficients[3] * out + v2;
        v2 = coefficients.coefficients[2] * in - coefficients.coefficients[4] * out;
        return out;
    }

    void processSamples(float* samples, int numSamples) noexcept {
        if (!active) return;
        const auto c0 = coefficients.coefficients[0];
        const auto c1 = coefficients.coefficients[1];
        const auto c2 = coefficients.coefficients[2];
        const auto c3 = coefficients.coefficients[3];
        const auto c4 = coefficients.coefficients[4];
        auto lv1 = v1, lv2 = v2;
        for (int i = 0; i < numSamples; ++i) {
            const auto in = samples[i];
            const auto out = c0 * in + lv1;
            samples[i] = out;
            lv1 = c1 * in - c3 * out + lv2;
            lv2 = c2 * in - c4 * out;
        }
        // Snapped once a block, where JUCE snaps: what keeps a decaying state out of denormals between blocks.
        snapToZero(lv1);
        v1 = lv1;
        snapToZero(lv2);
        v2 = lv2;
    }

private:
    juce::IIRCoefficients coefficients;
    float v1 = 0.0f, v2 = 0.0f;
    bool active = false;
};

}  // namespace studio
