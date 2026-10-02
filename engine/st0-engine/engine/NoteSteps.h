// NoteSteps.h — which strikes of a MIDI graph's clock actually play, and how loud: a rhythm over
// the step count (none, burst, Euclid), accents among the hits, a chance per step, a decay per repeat.
//
// JUCE-free and header-only, so tests/ have it in the FAST binary like NoteClock.h, which consults it.
// The one thing a reader would get wrong: the nodes that set it (`mpattern`, `maccent`, `mchance`,
// `mdecay`) write FIELDS here once a block — the decisions are made per strike, in NoteClock::advance.
// See docs/midiGraph.md.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace studio {

/** How the steps of one cycle are chosen; the VALUE is what `mpattern`'s mode input carries. */
enum class StepMode { all = 0, burst = 1, euclid = 2 };

/** The rule, as the graph's nodes last set it. Every default is "strike every step, as played". */
struct NoteSteps {
    static constexpr int maxLength = 32;
    /** The quietest a strike may get: a note-on of velocity 0 is a note-off in MIDI. */
    static constexpr float minVelocity = 1.0f / 127.0f;

    StepMode mode = StepMode::all;
    int length = 16;
    // Shares of the cycle, 0..1: how many of its steps play, and how far the pattern is turned.
    float density = 1.0f;
    float rotate = 0.0f;
    // Accents: the share of hits played as played (1 = all), the level the others drop to, and two switches.
    float accents = 1.0f;
    float low = 0.5f;
    bool opposite = false;
    bool keep = false;
    // The chance a step plays at all, and the share of velocity each repeat loses after the first.
    float chance = 1.0f;
    float decay = 0.0f;

    int cycle() const noexcept { return std::clamp(length, 1, maxLength); }

    /** How many of the cycle's steps play. */
    int pulses() const noexcept
    {
        const int n = cycle();
        if (mode == StepMode::all) return n;
        return std::clamp((int)std::lround(std::clamp(density, 0.0f, 1.0f) * n), 0, n);
    }

    /** Whether the pattern plays step `i` of the cycle — before chance, which is the clock's to roll. */
    bool hit(int i) const noexcept
    {
        const int n = cycle();
        const int k = pulses();
        const int at = turned(i, n);
        if (mode == StepMode::burst) return at < k;
        if (mode == StepMode::euclid) return euclid(at, k, n);
        return true;
    }

    /** Whether step `i`, a hit, is accented. Accents are spread over the HITS, or over the STEPS when `keep`. */
    bool accented(int i) const noexcept
    {
        const int n = cycle();
        bool on;
        if (keep) {
            // On the step grid, turned with the pattern: changing the density leaves them where they were.
            on = euclid(turned(i, n), share(accents, n), n);
        } else {
            // Among the hits: the j-th hit of the cycle, spread like a Euclid of its own.
            int j = 0;
            const int at = i % n;
            for (int s = 0; s < at; ++s) j += hit(s) ? 1 : 0;
            const int hits = pulses();
            on = hits > 0 && euclid(j, share(accents, hits), hits);
        }
        return on != opposite;
    }

    /** The velocity step `i` plays at, the `repeat`-th strike since the keys went down, for one played at `played`. */
    float velocity(int i, int repeat, float played) const noexcept
    {
        float v = played * (accented(i) ? 1.0f : std::clamp(low, 0.0f, 1.0f));
        v *= std::pow(1.0f - std::clamp(decay, 0.0f, 1.0f), (float)std::max(0, repeat));
        return std::clamp(v, minVelocity, 1.0f);
    }

private:
    /** Step `i` as the pattern sees it, after the turn — rotate is a share of the cycle, rounded to a step. */
    int turned(int i, int n) const noexcept
    {
        const int r = (int)std::lround(std::clamp(rotate, 0.0f, 1.0f) * n) % n;
        return ((i % n) + n - r) % n;
    }

    static int share(float s, int n) noexcept
    {
        return std::clamp((int)std::lround(std::clamp(s, 0.0f, 1.0f) * n), 0, n);
    }

    /** The Bresenham form of a Euclidean rhythm: k pulses spread as evenly as n steps allow, the first on step 0. */
    static bool euclid(int i, int k, int n) noexcept
    {
        if (k <= 0 || n <= 0) return false;
        if (k >= n) return true;
        return (i * k) % n < k;
    }
};

}  // namespace studio
