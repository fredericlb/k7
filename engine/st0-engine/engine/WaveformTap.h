// WaveformTap.h — a lock-free audio tap capturing a min/max envelope for real-time display. It sits post-fader
// in a track's chain and writes into a single-producer/single-consumer ring buffer with an atomic write head:
// the audio thread pushes every sample, the message thread drains on each state broadcast. One tap per module.

#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace studio {

struct WaveformEnvelope {
    float min;  // minimum sample in this bucket (range -1..1)
    float max;  // maximum sample in this bucket
};

class WaveformTap {
public:
    // `bucketSize` is how many samples make one envelope point: at 44100 Hz with 256, a 512-sample block gives ~2.
    explicit WaveformTap(int bucketSize = 256)
        : bucketSize_(bucketSize > 0 ? bucketSize : 256) {}

    // Called per-FRAME from the audio thread: min/max across the current bucket, flushed as one envelope point when the bucket fills.
    void pushSample(float sample) { pushFrame(sample, sample); }

    // A stereo frame, both sides folded into ONE bucket: the drain is a single chronological stream — docs/engineHost.md.
    void pushFrame(float left, float right) {
        const float lo = left < right ? left : right;
        const float hi = left < right ? right : left;
        if (samplesInBucket_ == 0) {
            curMin_ = lo;
            curMax_ = hi;
        } else {
            if (lo < curMin_) curMin_ = lo;
            if (hi > curMax_) curMax_ = hi;
        }
        if (++samplesInBucket_ >= bucketSize_) {
            const auto pos = writeHead_.load(std::memory_order_relaxed);
            buffer_[pos & MASK] = { curMin_, curMax_ };
            writeHead_.store(pos + 1, std::memory_order_release);
            samplesInBucket_ = 0;
        }
    }

    // Drain every point accumulated since the last drain, from the message thread at the broadcast cadence, in chronological order.
    std::vector<WaveformEnvelope> drain() {
        const auto written = writeHead_.load(std::memory_order_acquire);
        const auto avail = written - lastRead_;
        if (avail == 0) return {};

        // Capped short of the buffer size: a writer that lapped us may be writing the slots nearest its head, and parenthesised against windows.h's min().
        const auto count = (std::min)(avail, static_cast<size_t>(BUFFER_SIZE - MARGIN));
        const auto start = written - count;
        std::vector<WaveformEnvelope> out(count);
        for (size_t i = 0; i < count; ++i)
            out[i] = buffer_[(start + i) & MASK];
        lastRead_ = written;
        return out;
    }

    // Reset the whole ring — MESSAGE THREAD ONLY, never the plugin's reset(): rewinding under a nonzero `lastRead_` underflows and reads back as a full ring of stale points.
    void reset() {
        writeHead_.store(0, std::memory_order_release);
        lastRead_ = 0;
        samplesInBucket_ = 0;
    }

    // The writer's own state and nothing the reader owns, so it is safe on the audio thread: a repositioned transport drops the half-filled bucket, not the ring.
    void resetBucket() { samplesInBucket_ = 0; }

private:
    static constexpr size_t BUFFER_SIZE = 1024;
    static constexpr size_t MASK = BUFFER_SIZE - 1;
    // Points a lapped drain leaves behind: more than one block writes (4096 frames at 256 a point is 16).
    static constexpr size_t MARGIN = 32;

    std::array<WaveformEnvelope, BUFFER_SIZE> buffer_{};
    std::atomic<size_t> writeHead_{0};
    size_t lastRead_ = 0;

    // Accumulation state (audio thread only — no synchronization needed)
    float curMin_ = 0;
    float curMax_ = 0;
    int samplesInBucket_ = 0;
    int bucketSize_;
};

}  // namespace studio
