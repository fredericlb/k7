// NaturalizeDither.h — Airwindows' "Naturalize" word-length stage, the output section of Righteous 4,
// for one channel: rounds to 16 or 24 bits, choosing floor or ceil so the leading digits stay near
// Benford's law, and carries the rounding error forward (noise shaping). From airwindows (MIT).
// The one change: the original renormalises its bins with `if (total = 0)`, an assignment that
// divides them by zero; this compares. JUCE-free so tests/NaturalizeDither_test.cpp links nothing.

#pragma once

#include <cmath>

namespace studio {

class NaturalizeDither {
public:
    NaturalizeDither() { reset(); }

    /** Back to the state a fresh instance has: Benford's own proportions, no error carried. */
    void reset() {
        static constexpr double benford[10] = {1000, 301, 176, 125, 97, 79, 67, 58, 51, 46};
        for (int i = 0; i < 10; ++i) byn_[i] = benford[i];
        byn_[10] = 0;
        shaping_ = 0;
    }

    /** `x` rounded to `bits` (16 or 24) and scaled back to ±1; anything else passes untouched. */
    double process(double x, int bits) {
        if (bits != 16 && bits != 24) return x;
        const double dry = x;
        const double scale = bits == 24 ? 8388608.0 : 32768.0;
        x = (x - shaping_) * scale;

        const int a = bin(std::floor(x));
        const int b = bin(std::ceil(x));
        // Each candidate scored by how far the bins would sit from Benford with it counted: smaller wins.
        const double ta = score(a), tb = score(b);
        if (ta < tb) {
            byn_[a] += 1;
            x = std::floor(x);
        } else {
            byn_[b] += 1;
            x = std::ceil(x);
        }

        double total = 0;
        for (int i = 1; i <= 9; ++i) total += byn_[i];
        total /= 1000;
        if (total == 0) total = 1;
        for (int i = 1; i <= 9; ++i) byn_[i] /= total;
        byn_[10] /= 2;  // the catch-all for a value with no leading digit

        x /= scale;
        shaping_ += x - dry;
        return x;
    }

private:
    // The leading digit of a non-negative value, 1..9; 10 for anything else (zero, a negative).
    static int bin(double v) {
        while (v >= 1.0) v /= 10;
        for (int k = 0; k < 5 && v < 1.0; ++k) v *= 10;
        const int d = (int)std::floor(v);
        return d > 0 && d < 10 ? d : 10;
    }

    // How far the nine bins are from Benford's counts once `hot` is counted; the catch-all scores 0.
    double score(int hot) {
        if (hot == 10) return 0;
        static constexpr double target[10] = {0, 301, 176, 125, 97, 79, 67, 58, 51, 46};
        byn_[hot] += 1;
        double t = 0;
        for (int i = 1; i <= 9; ++i) t += target[i] - byn_[i];
        byn_[hot] -= 1;
        return t;
    }

    double byn_[11];
    double shaping_;
};

}  // namespace studio
