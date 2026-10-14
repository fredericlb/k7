// Quick Master's HF limit, To Vinyl 4's: at zero it is exactly transparent, it leaves a low tone
// alone and tames a high one, and the amount is felt as a cube. What it SOUNDS like is not a
// test's to say — see ../docs/quickMaster.md.

#include "AccelerationLimiter.h"
#include "test_harness.h"

#include <cmath>

using studio::AccelerationLimiter;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;

/** The RMS of a sine at `hz` through the limiter at `amount`, against the same sine untouched. */
double gainAt(double hz, double amount) {
    AccelerationLimiter lim;
    const double k = AccelerationLimiter::intensityFor(amount, kRate);
    double in = 0, out = 0;
    for (int i = 0; i < 48000; ++i) {
        const double x = 0.8 * std::sin(2 * kPi * hz * i / kRate);
        const double y = lim.process(x, k);
        if (i < 480) continue;  // past the first three samples' history
        in += x * x;
        out += y * y;
    }
    return std::sqrt(out / in);
}

void zero_is_exactly_transparent() {
    AccelerationLimiter lim;
    bool same = true;
    for (int i = 0; i < 1000; ++i) {
        const double x = std::sin(i * 0.7) * 0.9;
        same = same && lim.process(x, AccelerationLimiter::intensityFor(0.0, kRate)) == x;
    }
    CHECK(same);
}

void leaves_the_low_end_and_tames_the_top() {
    // Full amount: a 100 Hz tone bends slowly and passes; a 12 kHz one bends hard and is pulled down.
    CHECK(gainAt(100.0, 1.0) > 0.99);
    CHECK(gainAt(12000.0, 1.0) < 0.9);
}

void the_amount_is_a_cube() {
    // Half the knob is an eighth of the intensity, so it bites far less than half as hard.
    CHECK(AccelerationLimiter::intensityFor(0.5, kRate) ==
          AccelerationLimiter::intensityFor(1.0, kRate) / 8.0);
    // At 4 kHz, where it does not yet saturate, each step of the knob takes more off.
    CHECK(gainAt(4000.0, 0.25) > gainAt(4000.0, 0.5));
    CHECK(gainAt(4000.0, 0.5) > gainAt(4000.0, 1.0));
}

}  // namespace

int main() {
    RUN(zero_is_exactly_transparent);
    RUN(leaves_the_low_end_and_tames_the_top);
    RUN(the_amount_is_a_cube);
    TEST_MAIN_END();
}
