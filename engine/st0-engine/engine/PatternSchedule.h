// PatternSchedule.h — a pattern lane's notes between the worker that queries ahead and the audio thread that plays them.
// JUCE-free and header-only so tests/ has it in the FAST binary, like Arpeggiator.h. Never allocates after construction.
// The one thing a reader would get wrong: a note is in EDIT SECONDS, stamped with an epoch — every seek, stop or tempo
// change starts a new epoch, and a note from an old one is dropped unplayed rather than trusted (docs/patternPlugin.md).

#pragma once

#include "NoteClock.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace studio {

/** One note to play, in edit seconds, from the epoch it was scheduled in; a `sample` slot makes it a one-shot instead. */
struct TimedNote {
    double start = 0.0;
    double end = 0.0;
    int key = 60;
    float vel = 0.9f;
    uint32_t epoch = 0;
    int sample = -1;  // a slot of the plugin's sample store, or -1 for a MIDI note
};

/** A one-shot to start `at` seconds into the block — a sample has no note-off, it plays to its end. */
struct SampleHit {
    double at = 0.0;
    int slot = 0;
    float gain = 1.0f;
};

/** The edit's tempo and metre, which is what turns a cycle into seconds: one cycle is one BAR (the Tidal convention). */
struct PatternTempo {
    double bpm = 120.0;
    double beatsPerCycle = 4.0;
    double secondsPerCycle() const { return beatsPerCycle * 60.0 / std::max(bpm, 20.0); }
    bool operator==(const PatternTempo& o) const { return bpm == o.bpm && beatsPerCycle == o.beatsPerCycle; }
};

/** Single-producer single-consumer ring: the worker pushes, the audio thread pops, neither ever blocks. */
template <typename T, size_t N>
class SpscRing {
public:
    bool push(const T& v) {
        const size_t h = head_.load(std::memory_order_relaxed);
        const size_t next = (h + 1) % N;
        if (next == tail_.load(std::memory_order_acquire)) return false;
        items_[h] = v;
        head_.store(next, std::memory_order_release);
        return true;
    }
    bool pop(T& v) {
        const size_t t = tail_.load(std::memory_order_relaxed);
        if (t == head_.load(std::memory_order_acquire)) return false;
        v = items_[t];
        tail_.store((t + 1) % N, std::memory_order_release);
        return true;
    }

private:
    std::array<T, N> items_{};
    std::atomic<size_t> head_{0};
    std::atomic<size_t> tail_{0};
};

/** The audio thread's half, plus the few atomics it publishes for the worker. */
class PatternSchedule {
public:
    static constexpr int maxPending = 512;
    static constexpr int maxSounding = 128;
    /** Two blocks that meet within this are one continuous run; farther apart is a seek. */
    static constexpr double seamSeconds = 1.0e-4;
    /** A note this late still plays, at the top of the block: what a seek costs the first beat, since the worker reacts after it. */
    static constexpr double lateToleranceSeconds = 0.03;

    SpscRing<TimedNote, 1024> ring;

    /** The notes to emit in [blockStart, blockEnd), `at` seconds into the block, ordered; returns how many were written. */
    int process(double blockStart, double blockEnd, bool playing, const PatternTempo& tempo,
                NoteEvent* out, int maxOut, SampleHit* hits = nullptr, int* numHits = nullptr, int maxHits = 0) {
        const int n = begin(blockStart, blockEnd, playing, tempo, out, maxOut);
        return emit(blockStart, blockEnd, playing, out, n, maxOut, true, hits, numHits, maxHits);
    }

    /** Phase one: a new epoch wherever the queued notes stop being the right ones, releasing what sounds; returns the offs written. */
    int begin(double blockStart, double blockEnd, bool playing, const PatternTempo& tempo, NoteEvent* out,
              int maxOut) {
        int n = 0;
        const bool tempoMoved = !(tempo == tempo_);
        const bool seek = playing && wasPlaying_ && std::abs(blockStart - lastEnd_) > seamSeconds;
        const bool started = playing && !wasPlaying_ && std::abs(blockStart - anchor_.load()) > seamSeconds;
        const bool stopped = !playing && wasPlaying_;
        const bool movedWhileStopped = !playing && std::abs(blockStart - anchor_.load()) > seamSeconds;
        tempo_ = tempo;
        if (tempoMoved || seek || started || stopped || movedWhileStopped)
            n = restartAt(blockStart, out, maxOut);
        wasPlaying_ = playing;
        lastEnd_ = blockEnd;
        bpm_.store(tempo.bpm, std::memory_order_relaxed);
        beatsPerCycle_.store(tempo.beatsPerCycle, std::memory_order_relaxed);
        published_.store(playing ? blockEnd : blockStart, std::memory_order_release);
        return n;
    }

    /** Phase two: take what the ring holds and play this block's share of it after the `n` events already in `out`. */
    /** `takeRing` false discards what the worker sent instead: an offline render queries for itself (insert) and the two must not both land. */
    int emit(double blockStart, double blockEnd, bool playing, NoteEvent* out, int n, int maxOut,
             bool takeRing = true, SampleHit* hits = nullptr, int* numHits = nullptr, int maxHits = 0) {
        if (numHits) *numHits = 0;
        const auto put = [&](double at, int key, float vel) {
            if (n < maxOut) out[n++] = {at, key, 1, vel};
        };
        drainRing(takeRing);
        if (!playing) return n;

        // Note-offs due in this block come first at equal times, so a repeated key re-strikes rather than cuts.
        for (int i = 0; i < numSounding_;) {
            if (sounding_[i].end < blockEnd) {
                put(std::max(0.0, sounding_[i].end - blockStart), sounding_[i].key, 0.0f);
                sounding_[i] = sounding_[--numSounding_];
            } else {
                ++i;
            }
        }
        // Pending is sorted by start, so the block's notes are a prefix — played in time order, which a re-strike relies on.
        int used = 0;
        for (; used < numPending_ && pending_[used].start < blockEnd; ++used) {
            const TimedNote& p = pending_[used];
            if (p.start < blockStart - lateToleranceSeconds) {
                ++late_;
                continue;
            }
            const double at = std::max(0.0, p.start - blockStart);
            if (p.sample >= 0) {
                if (hits && numHits && *numHits < maxHits) hits[(*numHits)++] = {at, p.sample, p.vel};
                continue;
            }
            for (int k = 0; k < numSounding_; ++k)
                if (sounding_[k].key == p.key) {
                    put(at, p.key, 0.0f);
                    sounding_[k] = sounding_[--numSounding_];
                    break;
                }
            // An off for this key already due later in the block would cut the new note: it moves up to the strike.
            for (int k = 0; k < n; ++k)
                if (out[k].note == p.key && out[k].velocity == 0.0f && out[k].at > at) out[k].at = at;
            put(at, p.key, p.vel);
            if (p.end < blockEnd)
                put(std::max(at, p.end - blockStart), p.key, 0.0f);
            else if (numSounding_ < maxSounding)
                sounding_[numSounding_++] = {p.key, p.end};
        }
        std::copy(pending_.begin() + used, pending_.begin() + numPending_, pending_.begin());
        numPending_ -= used;
        sortByTime(out, n);
        return n;
    }

    /** Every sounding note off, nothing queued, and a new epoch anchored at `at` — a seek, a stop, a panic. */
    int restartAt(double at, NoteEvent* out, int maxOut) {
        int n = 0;
        for (int i = 0; i < numSounding_ && n < maxOut; ++i) out[n++] = {0.0, sounding_[i].key, 1, 0.0f};
        numSounding_ = 0;
        numPending_ = 0;
        anchor_.store(at, std::memory_order_relaxed);
        epoch_.store(epoch_.load(std::memory_order_relaxed) + 1, std::memory_order_release);
        return n;
    }

    /** Queues one note from the AUDIO thread's side — the offline render's path; a note from another epoch is dropped. */
    void insert(const TimedNote& t) {
        if (t.epoch != epoch_.load(std::memory_order_relaxed) || numPending_ >= maxPending) return;
        // Sorted insert: notes arrive window by window, in order, so this is almost always an append.
        int i = numPending_++;
        for (; i > 0 && pending_[i - 1].start > t.start; --i) pending_[i] = pending_[i - 1];
        pending_[i] = t;
    }

    // --- read by the worker ---
    uint32_t epoch() const { return epoch_.load(std::memory_order_acquire); }
    /** Where the worker schedules from when an epoch starts. */
    double anchor() const { return anchor_.load(std::memory_order_acquire); }
    /** The latest edit time the audio thread has reached — the playhead the look-ahead is measured from. */
    double playhead() const { return published_.load(std::memory_order_acquire); }
    /** The tempo the audio thread is converting with; the worker must use the same one or its notes land off the grid. */
    PatternTempo tempo() const { return {bpm_.load(std::memory_order_relaxed), beatsPerCycle_.load(std::memory_order_relaxed)}; }
    /** Notes that arrived too late to play: the worker fell behind, which the log should say. */
    uint64_t lateCount() const { return late_; }

private:
    struct Sounding {
        int key;
        double end;
    };

    void drainRing(bool keep) {
        TimedNote t;
        while (ring.pop(t))
            if (keep) insert(t);
    }

    // Insertion sort: a block holds a handful of events, and the list must leave in time order.
    static void sortByTime(NoteEvent* e, int n) {
        for (int i = 1; i < n; ++i)
            for (int j = i; j > 0 && e[j].at < e[j - 1].at; --j) std::swap(e[j], e[j - 1]);
    }

    std::array<TimedNote, maxPending> pending_{};
    int numPending_ = 0;
    std::array<Sounding, maxSounding> sounding_{};
    int numSounding_ = 0;
    PatternTempo tempo_{};
    bool wasPlaying_ = false;
    double lastEnd_ = 0.0;
    uint64_t late_ = 0;
    std::atomic<uint32_t> epoch_{1};
    std::atomic<double> anchor_{0.0};
    std::atomic<double> published_{0.0};
    std::atomic<double> bpm_{120.0};
    std::atomic<double> beatsPerCycle_{4.0};
};

/** The worker's half: how far it has scheduled, and in which epoch. Pure arithmetic over what the schedule publishes. */
struct PatternCursor {
    uint32_t epoch = 0;
    double scheduledCycle = 0.0;

    /** The cycle window to query now, or false when the look-ahead is already covered. Starts over on a new epoch. */
    bool window(const PatternSchedule& s, const PatternTempo& tempo, double lookaheadSeconds, double& from,
                double& to) {
        const double spc = tempo.secondsPerCycle();
        const uint32_t e = s.epoch();
        if (e != epoch) {
            epoch = e;
            scheduledCycle = s.anchor() / spc;
        }
        from = scheduledCycle;
        to = (s.playhead() + lookaheadSeconds) / spc;
        if (to <= from) return false;
        scheduledCycle = to;
        return true;
    }

    /** A lane event in cycles → a note (or, with a slot, a one-shot) in edit seconds, stamped with the cursor's epoch. */
    TimedNote timed(double cycle, double dur, int key, float vel, const PatternTempo& tempo, int sample = -1) const {
        const double spc = tempo.secondsPerCycle();
        return {cycle * spc, (cycle + dur) * spc, key, vel, epoch, sample};
    }
};

}  // namespace studio
