// RecorderTap.h — a lock-free PCM ring for a recorder NODE. Same single-producer/single-consumer
// shape as BroadcastTap, and owned by EngineHost for the same reason: a project rebuild must not
// pull the ring out from under the writer thread mid-take.
//
// It differs in ONE way, and that difference is the whole file: an overrun is COUNTED, not
// forgiven. See docs/recorder.md.

#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <string>
#include <vector>

namespace studio {

/** One finished take: where it landed, how long it is, and whether the ring lost any of it.
 *  Declared HERE and not beside RecorderNode, which sees JUCE: EngineHost.h reports takes and
 *  is the one public header, which is JUCE-free. */
struct RecorderTake {
    std::string file;
    double seconds = 0.0;
    bool damaged = false;
};

class RecorderTap {
public:
    // ALWAYS two, never adopted from the buffer — BroadcastTap's reason, and a take whose channel
    // count changed halfway would be unplayable rather than merely garbled.
    static constexpr int CHANNELS = 2;

    // Capacity in FRAMES, a power of two so the index is a mask. Four times the broadcast's, since
    // a disk write can stall far longer than a socket send: ~1.4 s at 48 kHz.
    static constexpr size_t CAPACITY = 65536;
    static constexpr size_t MASK = CAPACITY - 1;

    // How far behind the writer a LAPPED reader resumes. Not an optimisation: the slots nearest
    // the write head are the ones the audio thread is filling right now, and copying them gives a
    // frame whose two sides came from different moments — a tear, in the file, that nothing
    // reports. Better to lose a few thousand more frames and SAY so. Above the largest block any
    // device opens here — Android's 40 ms cap at 96 kHz is 3840 frames.
    static constexpr size_t MARGIN = 4096;
    static constexpr size_t SAFE = CAPACITY - MARGIN;

    RecorderTap() : buffer_(CAPACITY * CHANNELS, 0.0f) {}

    struct Drained {
        size_t frames = 0;      // frames copied into the caller's buffer
        size_t lostFrames = 0;  // frames the writer overwrote before we reached them
    };

    // AUDIO THREAD: allocates nothing and blocks on nothing, so it cannot refuse a block either.
    void pushBlock(const float* const* chans, int numChans, int numSamples) {
        if (numSamples <= 0 || numChans <= 0 || chans == nullptr) return;
        const auto pos = writeHead_.load(std::memory_order_relaxed);
        for (int c = 0; c < CHANNELS; ++c) {
            // Mono duplicates into both sides; anything wider keeps the first two.
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

    // WRITER THREAD and only that one, `lastRead_` being plain. Everything available, up to
    // `maxFrames` — no SAFE margin to resume behind: a recording wants the backlog, not the live
    // edge, so a slow drain is caught up with rather than skipped past (docs/recorder.md).
    Drained drain(std::vector<float>& out, size_t maxFrames) {
        const auto written = writeHead_.load(std::memory_order_acquire);
        Drained d;
        auto avail = written - lastRead_;
        if (avail > SAFE) {
            // The writer lapped us: those frames are GONE from the buffer and gone from the take.
            // Reported rather than hidden — a file that is silently short is a file you trust.
            d.lostFrames = avail - SAFE;
            lastRead_ = written - SAFE;
            avail = SAFE;
            lost_.fetch_add(d.lostFrames, std::memory_order_relaxed);
        }
        // Parenthesised so windows.h's min() macro cannot claim the call — WaveformTap.h's trap.
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
        // Checked AGAIN after the copy: a reader lapped mid-copy holds torn frames, zeroed and counted here (docs/recorder.md).
        std::atomic_thread_fence(std::memory_order_acquire);
        const auto after = writeHead_.load(std::memory_order_acquire);
        if (after - lastRead_ > SAFE) {
            const size_t torn = (std::min)(n, (size_t)(after - lastRead_ - SAFE));
            std::fill(out.begin(), out.begin() + (std::ptrdiff_t)(torn * CHANNELS), 0.0f);
            d.lostFrames += torn;
            lost_.fetch_add(torn, std::memory_order_relaxed);
        }
        lastRead_ += n;
        d.frames = n;
        return d;
    }

    // Start from NOW: the take begins at the record press, not at whatever is still in the ring.
    void skipToLive() {
        lastRead_ = writeHead_.load(std::memory_order_acquire);
        lost_.store(0, std::memory_order_relaxed);
    }

    // How many frames this take has lost altogether — 0 is the only good answer, and it is why a
    // take carries `damaged` rather than the client having to compare durations to notice.
    size_t lostFrames() const { return lost_.load(std::memory_order_relaxed); }

    // The rate the samples are actually at, published by the plugin and read by the writer for the
    // wav header — atomic across those two threads, 0 until the plugin is first initialised.
    void setSampleRate(double sr) { sampleRate_.store(sr, std::memory_order_relaxed); }
    double sampleRate() const { return sampleRate_.load(std::memory_order_relaxed); }

private:
    std::vector<float> buffer_;
    std::atomic<size_t> writeHead_{0};
    std::atomic<double> sampleRate_{0.0};
    std::atomic<size_t> lost_{0};
    size_t lastRead_ = 0;
};

}  // namespace studio
