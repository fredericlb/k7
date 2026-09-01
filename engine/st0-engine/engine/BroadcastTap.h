// BroadcastTap.h — a lock-free PCM ring for network broadcast. Same single-producer/
// single-consumer shape as WaveformTap and for the same reason, but it carries interleaved
// SAMPLES rather than an envelope, and it is owned by EngineHost rather than by the plugin
// so that a project rebuild cannot pull it out from under the sender. See docs/broadcast.md.

#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <vector>

namespace studio {

class BroadcastTap {
public:
    // ALWAYS two and never adopted from the buffer, since a stride that changed between a push and a drain would garble the backlog (docs/broadcast.md).
    static constexpr int CHANNELS = 2;

    // Capacity in FRAMES, a power of two so the index is a mask: ~340 ms at 48 kHz, enough to ride out a stall without losing audio.
    static constexpr size_t CAPACITY = 16384;
    static constexpr size_t MASK = CAPACITY - 1;

    // How far behind the writer the reader resumes after an overrun — 2048 frames, four times the largest block configured here, so it never copies slots being written.
    static constexpr size_t MARGIN = 2048;
    static constexpr size_t SAFE = CAPACITY - MARGIN;

    BroadcastTap() : buffer_(CAPACITY * CHANNELS, 0.0f) {}

    struct Drained {
        size_t frames = 0;      // frames copied into the caller's buffer
        size_t lostFrames = 0;  // frames the writer overwrote before we reached them
    };

    // AUDIO THREAD: allocates nothing and blocks on nothing, so overwriting the oldest frames is the point — the alternative is a callback waiting on a socket.
    void pushBlock(const float* const* chans, int numChans, int numSamples) {
        if (numSamples <= 0 || numChans <= 0 || chans == nullptr) return;
        const auto pos = writeHead_.load(std::memory_order_relaxed);
        for (int c = 0; c < CHANNELS; ++c) {
            // Mono duplicates into both sides, and anything wider keeps the first two — for a master bus, the pair that leaves the interface.
            const float* src = chans[c < numChans ? c : 0];
            if (src == nullptr) {
                for (int i = 0; i < numSamples; ++i)
                    buffer_[(((pos + (size_t)i) & MASK) * CHANNELS) + (size_t)c] = 0.0f;
                continue;
            }
            for (int i = 0; i < numSamples; ++i)
                buffer_[(((pos + (size_t)i) & MASK) * CHANNELS) + (size_t)c] = src[i];
        }
        writeHead_.store(pos + (size_t)numSamples, std::memory_order_release);
    }

    // SENDER THREAD and only that one, since `lastRead_` is plain: fills `out` and reports the frames lost to overwriting, which becomes a sequence jump.
    Drained drain(std::vector<float>& out, size_t maxFrames) {
        const auto written = writeHead_.load(std::memory_order_acquire);
        Drained d;
        auto avail = written - lastRead_;
        if (avail > SAFE) {
            // The writer lapped us, so resume SAFE rather than CAPACITY behind — exactly a ring back is the block being written, and every overrun would tear (docs/broadcast.md).
            d.lostFrames = avail - SAFE;
            lastRead_ = written - SAFE;
            avail = SAFE;
        }
        // Parenthesised so windows.h's min() macro cannot claim the call — main.cpp pulls winsock2 in through IXWebSocket, the same trap WaveformTap.h names.
        const size_t n = (std::min)(avail, maxFrames);
        if (n == 0) {
            out.clear();
            return d;
        }
        out.resize(n * CHANNELS);
        for (size_t i = 0; i < n; ++i) {
            const size_t at = ((lastRead_ + i) & MASK) * CHANNELS;
            for (int c = 0; c < CHANNELS; ++c)
                out[i * CHANNELS + (size_t)c] = buffer_[at + (size_t)c];
        }
        lastRead_ += n;
        d.frames = n;
        return d;
    }

    // Start from NOW, on the SENDER thread alone since `lastRead_` belongs to it; the write head is never touched, the audio thread being mid-block.
    void skipToLive() { lastRead_ = writeHead_.load(std::memory_order_acquire); }

    // The rate the samples are actually at, published by the plugin and read by the sender for the frame header — atomic across those two threads, 0 until first initialised.
    void setSampleRate(double sr) { sampleRate_.store(sr, std::memory_order_relaxed); }
    double sampleRate() const { return sampleRate_.load(std::memory_order_relaxed); }

private:
    std::vector<float> buffer_;
    std::atomic<size_t> writeHead_{0};
    std::atomic<double> sampleRate_{0.0};
    size_t lastRead_ = 0;
};

}  // namespace studio
