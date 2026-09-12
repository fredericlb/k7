// NoteClock.h — the state a MIDI graph keeps between blocks: which keys are down, which copies are
// sounding, and the step clock over them. It produces note EVENTS rather than MIDI messages.
//
// JUCE-free and header-only so tests/ can have it in the FAST binary, like Arpeggiator.h.
// The one thing a reader would get wrong: every held note is struck on ONE shared clock, not on a
// clock of its own — a chord machine-guns together. See docs/midiGraph.md.

#pragma once

#include <algorithm>

namespace studio {

/** One note the clock asks for, `at` seconds into the block it was produced in. */
struct NoteEvent {
    double at = 0.0;
    int note = 0;
    int channel = 1;
    // Zero is a note-OFF: MIDI says a note-on of velocity 0 is one, so nothing else needs saying.
    float velocity = 0.0f;
};

/** The held notes and the clock over them. Owns no buffer and never allocates — docs/midiGraph.md. */
class NoteClock {
public:
    /** More than this held at once is a stuck key rather than a chord, and the array is fixed so nothing allocates. */
    static constexpr int maxHeld = 16;
    /** Under this a step is a hang and not a rate: the loop below would fire until the block ran out. */
    static constexpr double minStepSeconds = 0.005;
    /** The longest step this trusts, so a nonsense rate cannot make one note last a minute. */
    static constexpr double maxStepSeconds = 8.0;
    /** How short a gate may be asked to be. Below it the note-off is inside the attack and nothing sounds. */
    static constexpr double minGate = 0.05;

    /** A key goes down, `at` seconds into the block — that offset is where the first strike lands. */
    void noteOn(int note, float velocity, int channel, double at = 0.0) noexcept
    {
        if (note < 0 || note > 127) return;
        if (indexOf(note) >= 0 || heldCount_ >= maxHeld) return;
        held_[heldCount_++] = {note, channel > 0 ? channel : 1, velocity > 0.0f ? velocity : 100.0f / 127.0f};
        // A note arriving on silence strikes AT ONCE: this is an instrument, and a key must sound when it is pressed.
        if (heldCount_ == 1) {
            nextIn_ = at > 0.0 ? at : 0.0;
            offIn_ = 0.0;
        }
    }

    /** …and goes up. Its copy is released on the next `advance`, which is what "until the note off" means. */
    void noteOff(int note) noexcept
    {
        const int i = indexOf(note);
        if (i < 0) return;
        for (int k = i; k + 1 < heldCount_; ++k) held_[k] = held_[k + 1];
        --heldCount_;
    }

    /** Everything let go and nothing sounding — what a stop leaves behind, and what deinitialise() asks for. */
    void reset() noexcept
    {
        heldCount_ = 0;
        soundingCount_ = 0;
        nextIn_ = 0.0;
        offIn_ = 0.0;
    }

    int held() const noexcept { return heldCount_; }
    /** How many copies are sounding. A whole chord at once, which is why this is a count and not a note. */
    int sounding() const noexcept { return soundingCount_; }

    /** Run `seconds` of block time, writing at most `max` events in time order; returns how many. */
    int advance(double seconds, double stepSeconds, double gate, NoteEvent* out, int max) noexcept
    {
        if (out == nullptr || max <= 0) return 0;
        const double step = std::min(maxStepSeconds, std::max(minStepSeconds, stepSeconds));
        const double open = std::min(1.0, std::max(minGate, gate));
        int n = 0;

        // A key let go releases its copy NOW, rather than at the end of a step nobody is holding.
        for (int i = soundingCount_ - 1; i >= 0 && n < max; --i)
            if (indexOf(sounding_[i].note) < 0) {
                out[n++] = {0.0, sounding_[i].note, sounding_[i].channel, 0.0f};
                dropSounding(i);
            }
        if (heldCount_ == 0) {
            nextIn_ = 0.0;
            offIn_ = 0.0;
            return n;
        }

        double t = 0.0;
        for (;;) {
            const double toOff = soundingCount_ > 0 ? offIn_ : never;
            // Overdue clocks read as due now: `t` only ever moves forward, so the events stay in order.
            const double dt = std::max(0.0, std::min(toOff, nextIn_));
            if (t + dt >= seconds) break;
            // A strike releases what is sounding in the SAME iteration, which is what a gate of 1 is.
            const bool strike = nextIn_ <= toOff;
            // The worst case of ONE iteration, checked before it starts: a half-written step is a stuck note.
            if (n + (strike ? soundingCount_ + heldCount_ : soundingCount_) > max) break;
            t += dt;
            offIn_ -= dt;
            nextIn_ -= dt;
            releaseAll(t, out, n);
            if (!strike) continue;
            for (int i = 0; i < heldCount_; ++i) {
                out[n++] = {t, held_[i].note, held_[i].channel, held_[i].velocity};
                sounding_[soundingCount_++] = held_[i];
            }
            offIn_ = step * open;
            nextIn_ = step;
        }
        const double rest = std::max(0.0, seconds - t);
        offIn_ -= rest;
        nextIn_ -= rest;
        return n;
    }

private:
    // Larger than any block, so a clock nothing is counting never fires.
    static constexpr double never = 1.0e9;

    struct Key {
        int note = 0;
        int channel = 1;
        float velocity = 0.0f;
    };

    int indexOf(int note) const noexcept
    {
        for (int i = 0; i < heldCount_; ++i)
            if (held_[i].note == note) return i;
        return -1;
    }

    void dropSounding(int i) noexcept
    {
        for (int k = i; k + 1 < soundingCount_; ++k) sounding_[k] = sounding_[k + 1];
        --soundingCount_;
    }

    // Everything sounding released at `t`. A strike landing on it releases first — a gate of 1 does exactly that.
    void releaseAll(double t, NoteEvent* out, int& n) noexcept
    {
        for (int i = 0; i < soundingCount_; ++i)
            out[n++] = {t, sounding_[i].note, sounding_[i].channel, 0.0f};
        soundingCount_ = 0;
    }

    Key held_[maxHeld] = {};
    Key sounding_[maxHeld] = {};
    int heldCount_ = 0;
    int soundingCount_ = 0;
    // Seconds until the sounding copies are released, and until the next strike.
    double offIn_ = 0.0;
    double nextIn_ = 0.0;
};

}  // namespace studio
