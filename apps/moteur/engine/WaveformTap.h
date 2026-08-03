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

    // Called per-sample from the audio thread: computes min/max across the current bucket and flushes an envelope
    // point when the bucket fills.
    void pushSample(float sample) {
        if (samplesInBucket_ == 0) {
            curMin_ = sample;
            curMax_ = sample;
        } else {
            if (sample < curMin_) curMin_ = sample;
            if (sample > curMax_) curMax_ = sample;
        }
        if (++samplesInBucket_ >= bucketSize_) {
            const auto pos = writeHead_.load(std::memory_order_relaxed);
            buffer_[pos & MASK] = { curMin_, curMax_ };
            writeHead_.store(pos + 1, std::memory_order_release);
            samplesInBucket_ = 0;
        }
    }

    // Drain every point accumulated since the last drain, from the message thread at the broadcast cadence.
    // Returns them in chronological order and resets the read position.
    std::vector<WaveformEnvelope> drain() {
        const auto written = writeHead_.load(std::memory_order_acquire);
        const auto avail = written - lastRead_;
        if (avail == 0) return {};

        // Cap at buffer size, so a writer that laps us can't be read as stale data. Parenthesised so windows.h's min()
        // macro can't claim the call: main.cpp pulls winsock2 in through IXWebSocket, where `std::min(a, b)` expands as
        // a two-argument macro.
        const auto count = (std::min)(avail, static_cast<size_t>(BUFFER_SIZE));
        const auto start = written - count;
        std::vector<WaveformEnvelope> out(count);
        for (size_t i = 0; i < count; ++i)
            out[i] = buffer_[(start + i) & MASK];
        lastRead_ = written;
        return out;
    }

    // Reset the buffer (e.g. when the tap is first enabled).
    void reset() {
        writeHead_.store(0, std::memory_order_release);
        lastRead_ = 0;
        samplesInBucket_ = 0;
    }

private:
    static constexpr size_t BUFFER_SIZE = 1024;
    static constexpr size_t MASK = BUFFER_SIZE - 1;

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
