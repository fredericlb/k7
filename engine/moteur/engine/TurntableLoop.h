// TurntableLoop.h — a platter's loop: two edges in record FRAMES, and the position a ROLL hands
// back when it is let go.
//
// JUCE-free and header-only so tests/ can have it in the FAST binary, like SessionRegistry.h.
// The one thing a reader would get wrong: whether a loop is a roll is latched when it ENGAGES and
// never read at release — see docs/turntable.md for the race that kills.

#pragma once

#include <cmath>

namespace studio {

/** Shorter than this is not a loop but a hang: two edges a hair apart would spin the audio thread. */
inline constexpr double loopMinFrames = 16.0;

class TurntableLoop {
public:
    bool active() const noexcept { return end_ - start_ >= loopMinFrames; }
    double start() const noexcept { return start_; }
    double end() const noexcept { return end_; }
    double length() const noexcept { return end_ - start_; }
    bool rolling() const noexcept { return rolling_; }
    double shadow() const noexcept { return shadow_; }

    /** Move the edges. Returns where the needle must go — `position` itself unless a roll just ended.
     *
     *  `roll` is read HERE and nowhere else. Latching it at the engage is what makes two params
     *  arriving one at a time safe: releasing only ever touches an edge. */
    double aim(double start, double end, bool roll, double position) noexcept
    {
        const auto was = active();
        start_ = start;
        end_ = end;
        const auto now = active();
        if (now && !was) {
            rolling_ = roll;
            shadow_ = position;
            return wrap(position);
        }
        if (was && !now) {
            const auto back = rolling_ ? shadow_ : position;
            rolling_ = false;
            return back;
        }
        // Edges moved UNDER a running loop — halved, doubled, or a needle dropped outside them.
        return now ? wrap(position) : position;
    }

    /** One step of `delta` record frames: wraps if a loop is on, and carries a roll's shadow either way. */
    double step(double position, double delta) noexcept
    {
        carry(delta);
        const auto moved = position + delta;
        return active() ? wrap(moved) : moved;
    }

    /** The shadow alone — the stretched path reads AHEAD, so what it advances is not what is heard. */
    void carry(double delta) noexcept
    {
        if (rolling_) shadow_ += delta;
    }

    /** A position brought inside the edges, whichever side it left by. Not a clamp: a loop WRAPS,
     *  and a platter driven backwards leaves by the start. */
    double wrap(double position) const noexcept
    {
        if (!active()) return position;
        if (position >= start_ && position < end_) return position;
        const auto off = std::fmod(position - start_, end_ - start_);
        return start_ + (off < 0.0 ? off + (end_ - start_) : off);
    }

private:
    double start_ = 0.0, end_ = 0.0, shadow_ = 0.0;
    bool rolling_ = false;
};

}  // namespace studio
