// The eurorack cores and the two headers every one of them leans on. JUCE-free, so it runs in a FAST
// binary: the cores are driven directly, at their own rate, with no Tracktion and no resampler.
//
// What would be wrong SILENTLY: a note that sounds at the wrong pitch (Warps, run at the host's rate,
// played an octave or more off and still sounded fine), a resonator re-initialised every block (Rings
// rang for 20 ms and nothing warned), a voice stolen while a free one waited. See ../docs/eurorack.md.

#include "Adsr.h"
#include "VoiceAllocator.h"
#include "cores/BraidsCore.h"
#include "cores/CloudsCore.h"
#include "cores/ElementsCore.h"
#include "cores/PeaksCore.h"
#include "cores/PlaitsCore.h"
#include "cores/RingsCore.h"
#include "cores/TidesCore.h"
#include "cores/WarpsCore.h"

#include "test_harness.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace studio::eurorack;

namespace {

/** A core's left output for `seconds`, one BLOCK at a time; `in` feeds a core with an input. */
template <typename Core>
std::vector<float> run(Core& core, double rate, int block, double seconds)
{
    std::vector<float> out, l((size_t)block), r((size_t)block);
    for (long n = 0; n < (long)(seconds * rate); n += block) {
        core.render(l.data(), r.data());
        out.insert(out.end(), l.begin(), l.end());
    }
    return out;
}

/** The fundamental by autocorrelation, the first peak within 10 % of the best: an octave-down pick is the failure. */
double f0(const std::vector<float>& x, double rate, double from, double span = 0.1)
{
    const size_t a = (size_t)(from * rate), n = (size_t)(span * rate);
    if (a + n > x.size()) return 0.0;
    const auto corr = [&](size_t lag) {
        double c = 0.0;
        for (size_t i = a; i + lag < a + n; ++i) c += (double)x[i] * x[i + lag];
        return c;
    };
    const size_t lo = (size_t)(rate / 2000.0), hi = (size_t)(rate / 40.0);
    double best = 0.0;
    for (size_t lag = lo; lag < hi; ++lag) best = std::max(best, corr(lag));
    for (size_t lag = lo + 1; lag < hi; ++lag) {
        const double c = corr(lag);
        if (c > 0.9 * best && c >= corr(lag - 1) && c >= corr(lag + 1)) {
            const double y0 = corr(lag - 1), y2 = corr(lag + 1);
            const double shift = 0.5 * (y0 - y2) / (y0 - 2 * c + y2);
            return rate / ((double)lag + shift);
        }
    }
    return 0.0;
}

double peak(const std::vector<float>& x, double rate, double from, double to)
{
    double p = 0.0;
    for (size_t i = (size_t)(from * rate); i < std::min(x.size(), (size_t)(to * rate)); ++i)
        p = std::max(p, (double)std::abs(x[i]));
    return p;
}

bool near(double got, double want, double tolerance = 0.01) { return std::abs(got / want - 1.0) < tolerance; }

}  // namespace

void voices_free_first_then_steal_the_oldest()
{
    VoiceAllocator<4> a;
    a.setVoices(3);
    CHECK(a.noteOn(60) == 0);
    CHECK(a.noteOn(62) == 1);
    CHECK(a.noteOn(64) == 2);
    // All three held: the fourth steals the oldest, never a voice past the count.
    CHECK(a.noteOn(65) == 0);
    CHECK(a.noteOff(62) == 1);
    // A released voice is taken before any held one is stolen.
    CHECK(a.noteOn(67) == 1);
}

void voices_retrigger_the_same_key()
{
    VoiceAllocator<4> a;
    const int v = a.noteOn(60);
    CHECK(a.noteOn(60) == v);
    CHECK(a.noteOff(60) == v);
    CHECK(a.noteOff(60) == VoiceAllocator<4>::NONE);
}

void voices_take_the_longest_released()
{
    VoiceAllocator<4> a;
    a.setVoices(2);
    a.noteOn(60);
    a.noteOn(62);
    a.noteOff(62);
    a.noteOff(60);
    // 62 was released first, so its tail is the older one and goes before 60's.
    CHECK(a.noteOn(64) == 1);
}

void adsr_holds_and_releases()
{
    Adsr e;
    e.set(1000.0, 0.01f, 0.05f, 0.5f, 0.1f);
    e.gateOn();
    float v = 0.0f;
    for (int i = 0; i < 10; ++i) v = e.next();
    CHECK(std::abs(v - 1.0f) < 1e-3f);
    for (int i = 0; i < 200; ++i) v = e.next();
    CHECK(std::abs(v - 0.5f) < 1e-3f);
    CHECK(e.stage() == Adsr::Stage::sustain);
    e.gateOff();
    // "Release 0.1 s" means silent by then, not 1/e of the way there.
    for (int i = 0; i < 101 && e.active(); ++i) e.next();
    CHECK(!e.active());
}

void adsr_released_mid_attack_falls_from_where_it_was()
{
    Adsr e;
    e.set(1000.0, 0.1f, 0.1f, 1.0f, 0.1f);
    e.gateOn();
    float v = 0.0f;
    for (int i = 0; i < 50; ++i) v = e.next();
    e.gateOff();
    const float after = e.next();
    CHECK(after < v);
    CHECK(after > 0.4f);
}

void plaits_plays_a440_and_goes_quiet()
{
    PlaitsCore c;
    c.init();
    c.noteOn(69, 0.8f);
    auto x = run(c, PlaitsCore::RATE, PlaitsCore::BLOCK, 0.5);
    CHECK(near(f0(x, PlaitsCore::RATE, 0.2), 440.0));
    c.noteOff(69);
    auto tail = run(c, PlaitsCore::RATE, PlaitsCore::BLOCK, 3.0);
    CHECK(peak(tail, PlaitsCore::RATE, 2.5, 3.0) < 1e-4);
}

void braids_plays_a440()
{
    BraidsCore c;
    c.init();
    c.noteOn(69, 0.8f);
    auto x = run(c, BraidsCore::RATE, BraidsCore::BLOCK, 0.4);
    CHECK(near(f0(x, BraidsCore::RATE, 0.2), 440.0));
}

void rings_string_plays_a440_and_rings_on()
{
    RingsCore c;
    c.init();
    c.params.model = 2;
    c.params.structure = 0.0f;
    c.params.brightness = 0.3f;
    c.noteOn(69, 0.8f);
    std::vector<float> x, l(RingsCore::BLOCK), r(RingsCore::BLOCK), in(RingsCore::BLOCK, 0.0f);
    for (int b = 0; b < (int)(RingsCore::RATE / RingsCore::BLOCK); ++b) {
        c.render(in.data(), l.data(), r.data());
        x.insert(x.end(), l.begin(), l.end());
    }
    CHECK(near(f0(x, RingsCore::RATE, 0.3), 440.0));
    // Still ringing half a second in: resonators re-initialised every block die within 20 ms.
    CHECK(peak(x, RingsCore::RATE, 0.5, 0.6) > 1e-3);
}

void elements_string_plays_a440()
{
    ElementsCore c;
    c.init();
    c.params.model = 1;
    c.params.space = 0.0f;
    c.noteOn(69, 0.8f);
    std::vector<float> x, l(ElementsCore::BLOCK), r(ElementsCore::BLOCK);
    for (int b = 0; b < (int)(0.5 * ElementsCore::RATE / ElementsCore::BLOCK); ++b) {
        c.render(nullptr, l.data(), r.data());
        x.insert(x.end(), r.begin(), r.end());
    }
    CHECK(near(f0(x, ElementsCore::RATE, 0.2), 440.0));
}

void tides_plays_a440()
{
    TidesCore c;
    c.init();
    c.params.output = 1;
    c.params.shift = 0.0f;
    c.noteOn(69, 0.8f);
    auto x = run(c, TidesCore::RATE, TidesCore::BLOCK, 0.4);
    CHECK(near(f0(x, TidesCore::RATE, 0.2), 440.0));
}

void warps_oscillator_is_in_tune_at_its_own_rate()
{
    WarpsCore c;
    c.init(WarpsCore::RATE);
    c.params.stereo = true;
    c.params.modulatorLevel = 0.0f;
    c.noteOn(69, 0.8f);
    std::vector<float> aux, l(WarpsCore::BLOCK), r(WarpsCore::BLOCK), zero(WarpsCore::BLOCK, 0.0f);
    for (int b = 0; b < (int)(0.4 * WarpsCore::RATE / WarpsCore::BLOCK); ++b) {
        c.render(zero.data(), zero.data(), l.data(), r.data());
        aux.insert(aux.end(), r.begin(), r.end());
    }
    // The auxiliary output carries the internal carrier; its pitch table assumes 96 kHz, hence the core's rate.
    CHECK(near(f0(aux, WarpsCore::RATE, 0.2), 440.0));
}

void clouds_dry_passes_the_input_through()
{
    CloudsCore c;
    c.init();
    c.params.dryWet = 0.0f;
    std::vector<float> in(CloudsCore::BLOCK), l(CloudsCore::BLOCK), r(CloudsCore::BLOCK), x;
    long n = 0;
    for (int b = 0; b < (int)(0.5 * CloudsCore::RATE / CloudsCore::BLOCK); ++b) {
        for (auto& s : in) s = 0.25f * (float)std::sin(2.0 * M_PI * 220.0 * (double)n++ / CloudsCore::RATE);
        c.render(in.data(), in.data(), l.data(), r.data());
        x.insert(x.end(), l.begin(), l.end());
    }
    CHECK(near(f0(x, CloudsCore::RATE, 0.3), 220.0));
    // Fully dry is the equal-power crossfade's 0.707, once the codec's halving is made back.
    CHECK(std::abs(peak(x, CloudsCore::RATE, 0.3, 0.5) - 0.25 * 0.707) < 0.02);
}

void peaks_kick_strikes_and_decays()
{
    PeaksCore c;
    c.init();
    c.noteOn(36, 1.0f);
    auto x = run(c, PeaksCore::RATE, PeaksCore::BLOCK, 2.0);
    const double strike = peak(x, PeaksCore::RATE, 0.0, 0.1);
    CHECK(strike > 0.1);
    // At least 30 dB down 1.5 s later: a drum that never lets go is a gate stuck high.
    CHECK(peak(x, PeaksCore::RATE, 1.5, 2.0) < strike / 30.0);
}

int main()
{
    RUN(voices_free_first_then_steal_the_oldest);
    RUN(voices_retrigger_the_same_key);
    RUN(voices_take_the_longest_released);
    RUN(adsr_holds_and_releases);
    RUN(adsr_released_mid_attack_falls_from_where_it_was);
    RUN(plaits_plays_a440_and_goes_quiet);
    RUN(braids_plays_a440);
    RUN(rings_string_plays_a440_and_rings_on);
    RUN(elements_string_plays_a440);
    RUN(tides_plays_a440);
    RUN(warps_oscillator_is_in_tune_at_its_own_rate);
    RUN(clouds_dry_passes_the_input_through);
    RUN(peaks_kick_strikes_and_decays);
    TEST_MAIN_END();
}
