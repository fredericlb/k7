// Arpeggiator.h — a held chord played one note at a time: the held set, the step clock and the
// walk over them, producing note EVENTS rather than MIDI messages.
//
// JUCE-free and header-only so tests/ can have it in the FAST binary, like TurntableLoop.h.
// The one thing a reader would get wrong: this clock counts SECONDS of block time and knows
// nothing of tempo — the plugin above is what turns a musical rate into one. See
// docs/arpeggiator.md.

#pragma once

#include <algorithm>
#include <cstdint>

namespace studio {

/** The orders the held notes are walked in; the VALUE is what the `Direction` parameter carries. */
enum class ArpDirection { up = 0, down = 1, upDown = 2, random = 3, custom = 4 };

/** …read off a parameter, which is a float and may be anything: outside the five, `up`. */
inline ArpDirection arpDirection(float value) noexcept
{
    const int i = (int)(value + 0.5f);
    return i == 1   ? ArpDirection::down
           : i == 2 ? ArpDirection::upDown
           : i == 3 ? ArpDirection::random
           : i == 4 ? ArpDirection::custom
                    : ArpDirection::up;
}

/** A drawn pattern: per step, 0 for a rest or the 1-based slot it plays — slot 1 the lowest held note. */
struct ArpPattern {
    const int* steps = nullptr;
    int length = 0;
    // Per step, a share of the played velocity (1 = as played) and of the step the note lasts; null reads as the defaults.
    const float* velocity = nullptr;
    const float* gate = nullptr;
};

/** One note the arpeggiator asks for, `at` seconds into the block it was produced in. */
struct ArpEvent {
    double at = 0.0;
    int note = 0;
    int channel = 1;
    // Zero is a note-OFF: MIDI says a note-on of velocity 0 is one, so nothing else needs saying.
    float velocity = 0.0f;
};

/** The held chord and the clock over it. Owns no buffer and never allocates — docs/arpeggiator.md. */
class Arpeggiator {
public:
    /** A chord wider than this is a stuck key rather than a chord, and the array is fixed so nothing allocates. */
    static constexpr int maxHeld = 16;
    /** How far the pattern may stack; the `Octaves` parameter is clamped to it. */
    static constexpr int maxOctaves = 4;
    /** Under this a step is a hang and not a rate: the loop below would fire until the block ran out. */
    static constexpr double minStepSeconds = 0.005;
    /** How much of its step a note lasts when no drawn step says otherwise — docs/arpeggiator.md. */
    static constexpr double gate = 0.5;
    /** The span a drawn gate is held to: a full gate puts a note-off and a note-on on one timestamp. */
    static constexpr double minGate = 0.05;
    static constexpr double maxGate = 0.95;
    /** The lowest tempo-derived step this trusts, so a nonsense rate cannot make one note last a minute. */
    static constexpr double maxStepSeconds = 8.0;
    /** The longest drawn pattern, and so the number of `Step n` parameters the plugin carries. */
    static constexpr int maxSteps = 16;

    /** A key goes down, `at` seconds into the block — that offset is where the first note of a chord lands. */
    void noteOn(int note, float velocity, int channel, double at = 0.0) noexcept
    {
        if (note < 0 || note > 127) return;
        if (velocity > 0.0f) velocity_ = velocity;
        if (channel > 0) channel_ = channel;
        int i = 0;
        while (i < heldCount_ && held_[i] < note) ++i;
        if (i < heldCount_ && held_[i] == note) return;
        if (heldCount_ >= maxHeld) return;
        for (int k = heldCount_; k > i; --k) held_[k] = held_[k - 1];
        held_[i] = note;
        ++heldCount_;
        // A chord arriving on silence plays AT ONCE and from its bottom note — it is an instrument, not a sequencer.
        if (heldCount_ == 1) {
            step_ = 0;
            nextIn_ = at > 0.0 ? at : 0.0;
        }
    }

    void noteOff(int note) noexcept
    {
        for (int i = 0; i < heldCount_; ++i)
            if (held_[i] == note) {
                for (int k = i; k + 1 < heldCount_; ++k) held_[k] = held_[k + 1];
                --heldCount_;
                return;
            }
    }

    /** Everything let go and nothing sounding — what a stop leaves behind, and what deinitialise() asks for. */
    void reset() noexcept
    {
        heldCount_ = 0;
        sounding_ = -1;
        step_ = 0;
        nextIn_ = 0.0;
        offIn_ = 0.0;
    }

    int held() const noexcept { return heldCount_; }
    /** The note currently playing, or -1. A single one, always: a step releases before it takes. */
    int sounding() const noexcept { return sounding_; }

    /** Run `seconds` of block time, writing at most `max` events in time order; returns how many. */
    int advance(double seconds, double stepSeconds, int octaves, ArpDirection dir, ArpEvent* out,
                int max, ArpPattern pattern = {}) noexcept
    {
        // Custom with nothing drawn is `up`: a pattern of no steps would be silence nobody chose.
        if (dir == ArpDirection::custom && (pattern.steps == nullptr || pattern.length <= 0))
            dir = ArpDirection::up;
        int n = 0;
        if (out == nullptr || max < 2) return 0;
        const double step = std::min(maxStepSeconds, std::max(minStepSeconds, stepSeconds));
        const int oct = std::min(maxOctaves, std::max(1, octaves));

        // The chord let go releases what is sounding NOW, rather than at the end of a step nobody is holding.
        if (heldCount_ == 0) {
            if (sounding_ >= 0) {
                out[n++] = {0.0, sounding_, channel_, 0.0f};
                sounding_ = -1;
            }
            step_ = 0;
            nextIn_ = 0.0;
            offIn_ = 0.0;
            return n;
        }

        double t = 0.0;
        while (n + 2 <= max) {
            const double toOff = sounding_ >= 0 ? offIn_ : never;
            const double toOn = nextIn_;
            // Overdue clocks read as due now: `t` only ever moves forward, so the events stay in order.
            const double dt = std::max(0.0, std::min(toOff, toOn));
            if (t + dt >= seconds) break;
            t += dt;
            offIn_ -= dt;
            nextIn_ -= dt;
            if (toOff <= toOn) {
                out[n++] = {t, sounding_, channel_, 0.0f};
                sounding_ = -1;
                continue;
            }
            // A step landing on a note still sounding releases it at the same instant — a gate of 1 would.
            if (sounding_ >= 0) {
                out[n++] = {t, sounding_, channel_, 0.0f};
                sounding_ = -1;
            }
            const bool drawn = dir == ArpDirection::custom;
            const int at = drawn ? (int)(step_ % (uint32_t)std::min(pattern.length, maxSteps)) : 0;
            const int slot = drawn ? pattern.steps[at] : 1;
            const float level = drawn && pattern.velocity ? pattern.velocity[at] : 1.0f;
            nextIn_ = step;
            // A drawn REST — or a step drawn silent — takes the step and plays nothing: the pattern stays on its grid.
            const float velocity = std::min(1.0f, velocity_ * level);
            if (slot <= 0 || !(velocity > 0.0f)) {
                ++step_;
                continue;
            }
            const int note = noteFor(step_, oct, dir, slot);
            out[n++] = {t, note, channel_, velocity};
            sounding_ = note;
            const double g = drawn && pattern.gate ? (double)pattern.gate[at] : gate;
            offIn_ = step * std::min(maxGate, std::max(minGate, g));
            ++step_;
        }
        const double rest = std::max(0.0, seconds - t);
        offIn_ -= rest;
        nextIn_ -= rest;
        return n;
    }

private:
    // Larger than any block, so a clock nothing is counting never fires.
    static constexpr double never = 1.0e9;

    /** The note the nth step plays: the walk picks a SLOT, and the slot is a note plus its octave. */
    int noteFor(uint32_t step, int octaves, ArpDirection dir, int drawn) noexcept
    {
        const int count = heldCount_ * octaves;
        int k = 0;
        switch (dir) {
            case ArpDirection::custom:
                // A slot past the chord wraps round it, so a pattern drawn for four notes still plays on three.
                k = (drawn - 1) % count;
                break;
            case ArpDirection::down:
                k = count - 1 - (int)(step % (uint32_t)count);
                break;
            case ArpDirection::upDown: {
                // Neither end is played twice, which is why the period is two short of twice the walk.
                const int period = count > 1 ? 2 * count - 2 : 1;
                const int j = (int)(step % (uint32_t)period);
                k = j < count ? j : period - j;
                break;
            }
            case ArpDirection::random:
                k = (int)(random() % (uint32_t)count);
                break;
            default:
                k = (int)(step % (uint32_t)count);
                break;
        }
        const int note = held_[k % heldCount_] + 12 * (k / heldCount_);
        // Clamped rather than folded: a stack running off the keyboard repeats its top note instead of jumping octave.
        return std::min(note, 127);
    }

    /** xorshift32 — the sequence has to be reproducible in a test, and no allocation may happen here. */
    uint32_t random() noexcept
    {
        seed_ ^= seed_ << 13;
        seed_ ^= seed_ >> 17;
        seed_ ^= seed_ << 5;
        return seed_;
    }

    int held_[maxHeld] = {};
    int heldCount_ = 0;
    int sounding_ = -1;
    int channel_ = 1;
    float velocity_ = 100.0f / 127.0f;
    uint32_t step_ = 0;
    uint32_t seed_ = 0x9e3779b9u;
    // Seconds until the sounding note is released, and until the next one is taken.
    double offIn_ = 0.0;
    double nextIn_ = 0.0;
};

}  // namespace studio
