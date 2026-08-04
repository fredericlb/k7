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
    // ALWAYS two, and fixed rather than adopted from the buffer. A count that could change
    // between a push and a drain would garble the frames already in the ring — the reader
    // would deinterleave them with the wrong stride — and the master output this taps is
    // stereo in every configuration the engine opens. Mono folds up, wider folds down.
    static constexpr int CHANNELS = 2;

    // Capacity in FRAMES, a power of two so the index is a mask: ~340 ms at 48 kHz, which
    // is far more than the sender needs and enough to ride out a stall without losing audio.
    static constexpr size_t CAPACITY = 16384;
    static constexpr size_t MASK = CAPACITY - 1;

    // How far behind the writer the reader is allowed to resume after an overrun. The gap
    // has to exceed one audio block, or the reader would copy the slots being written; 2048
    // frames is four times the largest block Tracktion is configured with here.
    static constexpr size_t MARGIN = 2048;
    static constexpr size_t SAFE = CAPACITY - MARGIN;

    BroadcastTap() : buffer_(CAPACITY * CHANNELS, 0.0f) {}

    struct Drained {
        size_t frames = 0;      // frames copied into the caller's buffer
        size_t lostFrames = 0;  // frames the writer overwrote before we reached them
    };

    // AUDIO THREAD. Allocates nothing (the buffer is sized in the constructor) and blocks
    // on nothing: overwriting the oldest frames is the whole point, because the alternative
    // is making the audio callback wait on a socket.
    void pushBlock(const float* const* chans, int numChans, int numSamples) {
        if (numSamples <= 0 || numChans <= 0 || chans == nullptr) return;
        const auto pos = writeHead_.load(std::memory_order_relaxed);
        for (int c = 0; c < CHANNELS; ++c) {
            // Mono duplicates into both sides; anything wider than stereo keeps the first
            // two channels, which for a master bus is the pair that leaves the interface.
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

    // SENDER THREAD, and only ever that one — `lastRead_` is plain, so a second reader
    // would race it. Fills `out` with up to `maxFrames` frames of interleaved samples and
    // says how many frames were lost to overwriting since the last call, which the sender
    // turns into a sequence-number jump so the listener learns it has a hole.
    Drained drain(std::vector<float>& out, size_t maxFrames) {
        const auto written = writeHead_.load(std::memory_order_acquire);
        Drained d;
        auto avail = written - lastRead_;
        if (avail > SAFE) {
            // The writer lapped us: everything older than CAPACITY is already gone. Resume
            // SAFE rather than CAPACITY behind — landing exactly CAPACITY behind would put
            // the read cursor on the slots the audio thread is writing this very block, so
            // the first frame after every overrun would be torn. A margin of one audio
            // block is what makes "we lost some" produce silence-then-audio rather than a
            // burst of noise, which is the one thing the whole protocol tries to avoid.
            d.lostFrames = avail - SAFE;
            lastRead_ = written - SAFE;
            avail = SAFE;
        }
        // Parenthesised so windows.h's min() macro can't claim the call — main.cpp pulls
        // winsock2 in through IXWebSocket. The same trap WaveformTap.h documents.
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

    // Start from NOW, called on the SENDER thread when a listener arrives: `lastRead_`
    // belongs to that thread, and moving it from anywhere else would race the drain. The
    // write head is never touched — the audio thread is mid-block and about to store it.
    void skipToLive() { lastRead_ = writeHead_.load(std::memory_order_acquire); }

    // The rate the samples are actually at, published by the plugin when the graph
    // prepares it and read by the sender for the frame header. Atomic because those are
    // two different threads, and 0 until the plugin has been initialised at least once.
    void setSampleRate(double sr) { sampleRate_.store(sr, std::memory_order_relaxed); }
    double sampleRate() const { return sampleRate_.load(std::memory_order_relaxed); }

private:
    std::vector<float> buffer_;
    std::atomic<size_t> writeHead_{0};
    std::atomic<double> sampleRate_{0.0};
    size_t lastRead_ = 0;
};

}  // namespace studio
