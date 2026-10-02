// Quick Master's output stage, the word length Righteous 4 rounds to: every sample lands ON the grid,
// the rounding error is carried rather than accumulated, and digital black stays black. What it
// SOUNDS like is not a test's to say — see ../docs/quickMaster.md.

#include "NaturalizeDither.h"
#include "test_harness.h"

#include <cmath>
#include <initializer_list>

using studio::NaturalizeDither;

namespace {

constexpr double kPi = 3.14159265358979323846;

void every_sample_lands_on_the_grid() {
    for (int bits : {16, 24}) {
        NaturalizeDither d;
        const double scale = bits == 24 ? 8388608.0 : 32768.0;
        bool onGrid = true;
        for (int i = 0; i < 48000; ++i) {
            const double x = 0.7 * std::sin(2 * kPi * 441.0 * i / 48000.0);
            const double y = d.process(x, bits) * scale;
            onGrid = onGrid && y == std::floor(y);
        }
        CHECK(onGrid);
    }
}

void the_error_is_carried_not_accumulated() {
    // Noise shaping hands each sample's error to the next, so the running sum stays within a step or two.
    NaturalizeDither d;
    double sum = 0, worst = 0;
    for (int i = 0; i < 96000; ++i) {
        const double x = 0.3 * std::sin(2 * kPi * 97.0 * i / 48000.0) + 1e-5;
        sum += d.process(x, 16) - x;
        worst = std::fmax(worst, std::fabs(sum));
    }
    CHECK(worst <= 2.0 / 32768.0);
}

void digital_black_stays_black() {
    NaturalizeDither d;
    bool silent = true;
    for (int i = 0; i < 1000; ++i) silent = silent && d.process(0.0, 16) == 0.0;
    CHECK(silent);
}

void float_passes_untouched() {
    NaturalizeDither d;
    CHECK(d.process(0.123456789, 0) == 0.123456789);
    CHECK(d.process(-0.5, 32) == -0.5);
}

void reset_forgets_the_carried_error() {
    NaturalizeDither a, b;
    for (int i = 0; i < 100; ++i) a.process(0.1234 + i * 1e-4, 16);
    a.reset();
    CHECK(a.process(0.25003, 16) == b.process(0.25003, 16));
}

}  // namespace

int main() {
    RUN(every_sample_lands_on_the_grid);
    RUN(the_error_is_carried_not_accumulated);
    RUN(digital_black_stays_black);
    RUN(float_passes_untouched);
    RUN(reset_forgets_the_carried_error);
    TEST_MAIN_END();
}
