// RateBridge.cpp — FIFOs around a fixed-block core, and libsamplerate either side of it when the
// rates differ. The converter is the copy Tracktion already compiles, inside `tracktion::src`.

#include "RateBridge.h"

#include <algorithm>
#include <cmath>
#include <cstring>

// Declared exactly as tracktion_engine_playback.cpp compiles it, so these names ARE Tracktion's copy.
namespace tracktion { namespace src {
#include <3rd_party/libsamplerate/samplerate.h>
}}

namespace studio::eurorack {

namespace src = tracktion::src;

namespace {

// Medium: one converter pair per plugin instance, never per voice, so the quality is cheap.
constexpr int CONVERTER = src::SRC_SINC_MEDIUM_QUALITY;
// run() is chunked to this, which is what bounds every buffer below.
constexpr int MAX_CHUNK = 1024;
// Priming slack past the measured worst case, for block-size patterns the measurement did not try.
constexpr int PRIMING_MARGIN = 8;

src::SRC_STATE* state(void* p) { return static_cast<src::SRC_STATE*>(p); }

}  // namespace

void RateBridge::Fifo::allocate(int ch, size_t frames)
{
    channels = std::max(ch, 1);
    buf.assign(frames * (size_t)channels, 0.0f);
    read = write = 0;
}

float* RateBridge::Fifo::space(size_t frames)
{
    const size_t cap = buf.size() / (size_t)channels;
    if (write + frames > cap && read > 0) {
        std::memmove(buf.data(), data(), size() * (size_t)channels * sizeof(float));
        write -= read;
        read = 0;
    }
    // Sized in prepare() for the worst chunk; past that we drop rather than allocate on the audio thread.
    if (write + frames > cap) return nullptr;
    return buf.data() + write * (size_t)channels;
}

void RateBridge::Fifo::consume(size_t frames)
{
    read += std::min(frames, size());
    if (read == write) read = write = 0;
}

RateBridge::~RateBridge()
{
    if (down_ != nullptr) src::src_delete(state(down_));
    if (up_ != nullptr) src::src_delete(state(up_));
}

void RateBridge::prepare(double hostRate, double coreRate, int coreBlock, int inChannels,
                         int outChannels, Core& core)
{
    hostRate_ = hostRate > 0.0 ? hostRate : 48000.0;
    coreRate_ = coreRate > 0.0 ? coreRate : hostRate_;
    block_ = std::max(coreBlock, 1);
    inCh_ = std::max(inChannels, 0);
    outCh_ = std::max(outChannels, 1);

    if (down_ != nullptr) down_ = src::src_delete(state(down_));
    if (up_ != nullptr) up_ = src::src_delete(state(up_));
    const bool convert = std::abs(hostRate_ - coreRate_) > 1e-6;
    int err = 0;
    if (convert && inCh_ > 0) down_ = src::src_new(CONVERTER, inCh_, &err);
    if (convert) up_ = src::src_new(CONVERTER, outCh_, &err);

    // Worst case for one chunk at the higher of the two rates, a core block either side, and the priming.
    const double ratio = std::max(hostRate_ / coreRate_, coreRate_ / hostRate_);
    const size_t frames = (size_t)std::ceil((MAX_CHUNK + 2 * block_) * ratio) + 4096;
    coreIn_.allocate(inCh_, frames);
    hostOut_.allocate(outCh_, frames);
    scratch_.assign(frames * (size_t)std::max(inCh_, outCh_), 0.0f);
    interleaveIn_.assign((size_t)block_ * (size_t)std::max(inCh_, 1), 0.0f);
    interleaveOut_.assign((size_t)block_ * (size_t)outCh_, 0.0f);
    planarIn_.assign((size_t)std::max(inCh_, 1), std::vector<float>((size_t)block_, 0.0f));
    planarOut_.assign((size_t)outCh_, std::vector<float>((size_t)block_, 0.0f));
    inPtrs_.resize(planarIn_.size());
    outPtrs_.resize(planarOut_.size());
    for (size_t c = 0; c < planarIn_.size(); ++c) inPtrs_[c] = planarIn_[c].data();
    for (size_t c = 0; c < planarOut_.size(); ++c) outPtrs_[c] = planarOut_[c].data();

    primed_ = 0;
    latency_ = 0;
    if (inCh_ == 0) {
        core_ = &core;
        reset();
        return;
    }

    // A processor lags: measure by how much with a core that copies, since the lag is the plumbing's, not the DSP's.
    struct Identity : Core {
        int in = 0, out = 0, n = 0;
        void renderBlock(const float* const* i, float* const* o) override
        {
            for (int c = 0; c < out; ++c) {
                if (i != nullptr && c < in) std::memcpy(o[c], i[c], sizeof(float) * (size_t)n);
                else std::fill_n(o[c], n, 0.0f);
            }
        }
    } identity;
    identity.in = inCh_;
    identity.out = outCh_;
    identity.n = block_;
    core_ = &identity;

    std::vector<std::vector<float>> in((size_t)inCh_), out((size_t)outCh_);
    std::vector<const float*> ip((size_t)inCh_);
    std::vector<float*> op((size_t)outCh_);
    // Priming = the worst (consumed - produced) with none, over two block patterns: one frame at a time, then big.
    primed_ = 0;
    long shortfall = 0;
    for (const int hostBlock : {1, 512}) {
        reset();
        for (auto& v : in) v.assign((size_t)hostBlock, 0.0f);
        for (size_t c = 0; c < ip.size(); ++c) ip[c] = in[c].data();
        long produced = 0, consumed = 0;
        for (int done = 0; done < (int)hostRate_ / 2; done += hostBlock) {
            produced += (long)lastProduced(ip.data(), hostBlock);
            consumed += hostBlock;
            shortfall = std::max(shortfall, consumed - produced);
        }
    }
    primed_ = (int)shortfall + PRIMING_MARGIN;

    // The latency: an impulse in, with the priming in place, and where it comes out.
    reset();
    const int span = (int)(hostRate_ / 5);
    for (auto& v : in) v.assign((size_t)span, 0.0f);
    for (auto& v : out) v.assign((size_t)span, 0.0f);
    in[0][0] = 1.0f;
    for (size_t c = 0; c < ip.size(); ++c) ip[c] = in[c].data();
    for (size_t c = 0; c < op.size(); ++c) op[c] = out[c].data();
    for (int done = 0; done < span; done += MAX_CHUNK) {
        const int n = std::min(MAX_CHUNK, span - done);
        std::vector<const float*> i2(ip.size());
        std::vector<float*> o2(op.size());
        for (size_t c = 0; c < ip.size(); ++c) i2[c] = ip[c] + done;
        for (size_t c = 0; c < op.size(); ++c) o2[c] = op[c] + done;
        runChunk(i2.data(), o2.data(), n);
    }
    int peakAt = 0;
    for (int i = 1; i < span; ++i)
        if (std::abs(out[0][(size_t)i]) > std::abs(out[0][(size_t)peakAt])) peakAt = i;
    latency_ = peakAt;

    core_ = &core;
    reset();
}

void RateBridge::prime()
{
    if (primed_ <= 0) return;
    float* dst = hostOut_.space((size_t)primed_);
    if (dst == nullptr) return;
    std::fill_n(dst, (size_t)primed_ * (size_t)outCh_, 0.0f);
    hostOut_.commit((size_t)primed_);
}

void RateBridge::reset()
{
    if (down_ != nullptr) src::src_reset(state(down_));
    if (up_ != nullptr) src::src_reset(state(up_));
    coreIn_.clear();
    hostOut_.clear();
    prime();
}

void RateBridge::run(const float* const* in, float* const* out, int n)
{
    if (core_ == nullptr || n <= 0) return;
    const float* inChunk[8];
    float* outChunk[8];
    for (int done = 0; done < n; done += MAX_CHUNK) {
        const int len = std::min(MAX_CHUNK, n - done);
        for (int c = 0; c < inCh_ && c < 8; ++c) inChunk[c] = in != nullptr ? in[c] + done : nullptr;
        for (int c = 0; c < outCh_ && c < 8; ++c) outChunk[c] = out[c] + done;
        runChunk(in != nullptr && inCh_ > 0 ? inChunk : nullptr, outChunk, len);
    }
}

void RateBridge::toHost(const float* interleaved, int frames)
{
    if (up_ == nullptr) {
        float* dst = hostOut_.space((size_t)frames);
        if (dst == nullptr) return;
        std::memcpy(dst, interleaved, sizeof(float) * (size_t)frames * (size_t)outCh_);
        hostOut_.commit((size_t)frames);
        return;
    }
    const size_t room = scratch_.size() / (size_t)outCh_;
    src::SRC_DATA d{};
    d.data_in = interleaved;
    d.input_frames = frames;
    d.src_ratio = hostRate_ / coreRate_;
    while (d.input_frames > 0) {
        d.data_out = scratch_.data();
        d.output_frames = (long)room;
        if (src::src_process(state(up_), &d) != 0) return;
        if (d.output_frames_gen > 0) {
            float* dst = hostOut_.space((size_t)d.output_frames_gen);
            if (dst == nullptr) return;
            std::memcpy(dst, scratch_.data(),
                        sizeof(float) * (size_t)d.output_frames_gen * (size_t)outCh_);
            hostOut_.commit((size_t)d.output_frames_gen);
        }
        if (d.input_frames_used == 0 && d.output_frames_gen == 0) return;
        d.data_in += d.input_frames_used * outCh_;
        d.input_frames -= d.input_frames_used;
    }
}

void RateBridge::renderOneBlock(const float* const* coreIn)
{
    core_->renderBlock(coreIn, outPtrs_.data());
    for (int i = 0; i < block_; ++i)
        for (int c = 0; c < outCh_; ++c)
            interleaveOut_[(size_t)(i * outCh_ + c)] = planarOut_[(size_t)c][(size_t)i];
    toHost(interleaveOut_.data(), block_);
}

size_t RateBridge::lastProduced(const float* const* in, int n)
{
    const size_t before = hostOut_.size();
    // Feed without consuming, so the count is what the chain made, not what is left of it.
    feed(in, n);
    const size_t made = hostOut_.size() - before;
    hostOut_.consume(hostOut_.size());
    return made;
}

void RateBridge::feed(const float* const* in, int n)
{
    if (inCh_ == 0 || in == nullptr) return;
    // Host input → core-rate FIFO, interleaved.
    for (int i = 0; i < n; ++i)
        for (int c = 0; c < inCh_; ++c)
            scratch_[(size_t)(i * inCh_ + c)] = in[c][i];
    if (down_ == nullptr) {
        float* dst = coreIn_.space((size_t)n);
        if (dst != nullptr) {
            std::memcpy(dst, scratch_.data(), sizeof(float) * (size_t)n * (size_t)inCh_);
            coreIn_.commit((size_t)n);
        }
    } else {
        src::SRC_DATA d{};
        d.data_in = scratch_.data();
        d.input_frames = n;
        d.src_ratio = coreRate_ / hostRate_;
        while (d.input_frames > 0) {
            const size_t want = (size_t)std::ceil(d.input_frames * d.src_ratio) + 16;
            float* dst = coreIn_.space(want);
            if (dst == nullptr) break;
            d.data_out = dst;
            d.output_frames = (long)want;
            if (src::src_process(state(down_), &d) != 0) break;
            coreIn_.commit((size_t)d.output_frames_gen);
            if (d.input_frames_used == 0 && d.output_frames_gen == 0) break;
            d.data_in += d.input_frames_used * inCh_;
            d.input_frames -= d.input_frames_used;
        }
    }
    // Every whole core block now available is rendered straight away.
    while (coreIn_.size() >= (size_t)block_) {
        const float* src = coreIn_.data();
        for (int i = 0; i < block_; ++i)
            for (int c = 0; c < inCh_; ++c)
                planarIn_[(size_t)c][(size_t)i] = src[(size_t)(i * inCh_ + c)];
        coreIn_.consume((size_t)block_);
        renderOneBlock(inPtrs_.data());
    }
}

void RateBridge::runChunk(const float* const* in, float* const* out, int n)
{
    if (inCh_ > 0) {
        // A processor with no input this block is fed silence, so its clock never stops.
        if (in == nullptr) {
            for (int c = 0; c < inCh_; ++c) std::fill_n(planarIn_[(size_t)c].data(), block_, 0.0f);
            // Read-only, so plain static: a thread_local's first touch can allocate, on the audio thread.
            static const float zeros[MAX_CHUNK] = {};
            const float* z[8];
            for (int c = 0; c < inCh_ && c < 8; ++c) z[c] = zeros;
            feed(z, n);
        } else {
            feed(in, n);
        }
    } else {
        // A generator renders on demand: exactly enough blocks to cover this chunk, never a lag.
        // Bounded, so a converter that stops producing costs one silent chunk rather than a hung audio thread.
        for (int guard = 0; hostOut_.size() < (size_t)n && guard < 4 * MAX_CHUNK; ++guard) {
            const size_t before = hostOut_.size();
            renderOneBlock(nullptr);
            // A render that added nothing will add nothing next time either: stop at one, not four thousand.
            if (hostOut_.size() == before) break;
        }
    }

    const size_t have = std::min(hostOut_.size(), (size_t)n);
    const float* src = hostOut_.data();
    for (size_t i = 0; i < have; ++i)
        for (int c = 0; c < outCh_; ++c)
            out[c][i] = src[i * (size_t)outCh_ + (size_t)c];
    // A shortfall is silence at the END, so what did arrive keeps its timing.
    for (int c = 0; c < outCh_; ++c) std::fill(out[c] + have, out[c] + n, 0.0f);
    hostOut_.consume(have);
}

}  // namespace studio::eurorack
