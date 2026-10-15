// AccelerationLimiter.h — To Vinyl 4's "H Limit", for one channel: where the waveform BENDS too fast
// (a large second difference: sibilance, cymbals, a hard top end) the sample is pulled toward the
// average of the last three. Level is never measured, which is what makes it a high-frequency
// limiter rather than a compressor. From airwindows (MIT), unchanged. JUCE-free, so
// tests/AccelerationLimiter_test.cpp links nothing.

#pragma once

#include <algorithm>
#include <cmath>

namespace studio {

class AccelerationLimiter {
public:
    /** Airwindows' intensity for an amount 0..1 at `rate` Hz: the amount CUBED, scaled for the rate. */
    static double intensityFor(double amount, double rate) {
        const double a = std::clamp(amount, 0.0, 1.0);
        return a * a * a * 32.0 / (rate > 0.0 ? rate / 44100.0 : 1.0);
    }

    void reset() { s1_ = s2_ = s3_ = o1_ = o2_ = o3_ = 0.0; }

    /** `x` with its fastest bends smoothed; an intensity of 0 returns it exactly. */
    double process(double x, double intensity) {
        s3_ = s2_;
        s2_ = s1_;
        s1_ = x;
        const double smooth = (s3_ + s2_ + s1_) / 3.0;
        const double m1 = (s1_ - s2_) * ((s1_ - s2_) / 1.3);
        const double m2 = (s2_ - s3_) * ((s1_ - s2_) / 1.3);
        double sense = intensity * intensity * std::fabs(m1 - m2);
        o3_ = o2_;
        o2_ = o1_;
        o1_ = sense;
        // Held over the last three samples, so one sharp edge is caught on both its sides.
        sense = std::min(1.0, std::max({sense, o2_, o3_}));
        return x * (1.0 - sense) + smooth * sense;
    }

private:
    double s1_ = 0, s2_ = 0, s3_ = 0, o1_ = 0, o2_ = 0, o3_ = 0;
};

}  // namespace studio
