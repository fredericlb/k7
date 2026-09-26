// RateBridge.h — carries audio between the host (any rate, any block size) and a eurorack core,
// which runs at ONE fixed rate and renders exactly `coreBlock` frames per call: its envelopes are
// clocked by that count, so a shorter call is a faster envelope, not a shorter block.
// A generator is pulled on demand; a processor lags by a fixed, measured latency. docs/eurorack.md.

#pragma once

#include <vector>

namespace studio::eurorack {

class RateBridge {
public:
    // One core block: `in` is null for a generator, else planar channels of `coreBlock` frames, like `out`.
    struct Core {
        virtual ~Core() = default;
        virtual void renderBlock(const float* const* in, float* const* out) = 0;
    };

    RateBridge() = default;
    ~RateBridge();
    RateBridge(const RateBridge&) = delete;
    RateBridge& operator=(const RateBridge&) = delete;

    /** Message thread: allocates, and measures the latency with an identity core. coreRate 0 means the host's. */
    void prepare(double hostRate, double coreRate, int coreBlock, int inChannels, int outChannels,
                 Core& core);
    /** Back to the state prepare() left: FIFOs emptied, converters cleared, the priming put back. */
    void reset();

    /** Host samples between an input and its output; 0 for a generator, which has no input to lag. */
    int latencySamples() const { return latency_; }
    double coreRate() const { return coreRate_; }

    /** Audio thread: `n` frames of `in` (null for a generator) in, `n` frames of the core's output out. */
    void run(const float* const* in, float* const* out, int n);

private:
    struct Fifo {
        std::vector<float> buf;
        int channels = 0;
        size_t read = 0, write = 0;   // in FRAMES
        void allocate(int ch, size_t frames);
        size_t size() const { return write - read; }
        float* space(size_t frames);  // compacts when needed; the caller commits what it wrote
        void commit(size_t frames) { write += frames; }
        const float* data() const { return buf.data() + read * (size_t)channels; }
        void consume(size_t frames);
        void clear() { read = write = 0; }
    };

    void runChunk(const float* const* in, float* const* out, int n);
    // Host input → core-rate FIFO → every whole core block rendered → host FIFO.
    void feed(const float* const* in, int n);
    // prepare()'s measure: what one feed adds to the host FIFO, which it then empties.
    size_t lastProduced(const float* const* in, int n);
    void renderOneBlock(const float* const* coreIn);
    // Interleaved `frames` at the core rate → the host FIFO, through the up converter when there is one.
    void toHost(const float* interleaved, int frames);
    void prime();

    Core* core_ = nullptr;
    double hostRate_ = 48000.0, coreRate_ = 48000.0;
    int block_ = 16, inCh_ = 0, outCh_ = 2;
    int primed_ = 0, latency_ = 0;

    void* down_ = nullptr;   // SRC_STATE*, host → core; null when the rates match
    void* up_ = nullptr;     // SRC_STATE*, core → host

    Fifo coreIn_, hostOut_;
    std::vector<float> scratch_;                      // converter output, interleaved
    std::vector<float> interleaveIn_, interleaveOut_;  // one core block, interleaved
    std::vector<std::vector<float>> planarIn_, planarOut_;
    std::vector<const float*> inPtrs_;
    std::vector<float*> outPtrs_;
};

}  // namespace studio::eurorack
