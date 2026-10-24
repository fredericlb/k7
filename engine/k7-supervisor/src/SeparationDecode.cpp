// SeparationDecode.cpp — see SeparationDecode.h. The decoder hands interleaved blocks over, which land
// straight in per-channel buffers: no interleaved copy of the whole song is ever held beside them.

#include "SeparationDecode.h"

#include <stdexcept>

#ifdef K7_WITH_DECODER
#include <k7_audio.h>

#include <algorithm>
#include <memory>
#endif

namespace k7::separation {

#ifdef K7_WITH_DECODER

namespace {

/** The library's error string as an exception, freed on the way. */
[[noreturn]] void throwError(char* error, const std::string& fallback)
{
    std::string text = error ? error : fallback;
    k7_audio_free_string(error);
    throw std::runtime_error(text);
}

void append(Channels& out, const float* frames, size_t count)
{
    const size_t n = out.size();
    for (size_t c = 0; c < n; ++c) {
        auto& ch = out[c];
        const size_t at = ch.size();
        ch.resize(at + count);
        for (size_t i = 0; i < count; ++i) ch[at + i] = frames[i * n + c];
    }
}

}  // namespace

Decoded decodeForModel(const std::string& path)
{
    char* error = nullptr;
    std::unique_ptr<K7Decode, decltype(&k7_decode_close)> d(k7_decode_open(path.c_str(), kSampleRate, kChannels, &error), &k7_decode_close);
    if (!d) throwError(error, "cannot decode " + path);
    Decoded out;
    out.sourceRate = static_cast<int>(k7_decode_source_rate(d.get()));
    out.channels.assign(kChannels, {});
    for (;;) {
        const float* frames = nullptr;
        size_t count = 0;
        if (k7_decode_next(d.get(), &frames, &count, &error) != 0) throwError(error, "cannot decode " + path);
        if (count == 0) break;
        append(out.channels, frames, count);
    }
    for (auto& ch : out.channels) ch.shrink_to_fit();
    return out;
}

Channels resample(const Channels& chans, int from, int to)
{
    const size_t n = chans.size();
    const size_t frames = n ? chans[0].size() : 0;
    char* error = nullptr;
    std::unique_ptr<K7Resample, decltype(&k7_resample_free)> r(
        k7_resample_new(static_cast<uint32_t>(from), static_cast<uint32_t>(to), static_cast<uint32_t>(n), &error), &k7_resample_free);
    if (!r) throwError(error, "cannot resample");
    Channels out(n);
    for (auto& ch : out) ch.reserve(static_cast<size_t>(static_cast<double>(frames) * to / from) + 1);
    constexpr size_t kBlock = 65536;
    std::vector<float> block;
    const float* got = nullptr;
    size_t count = 0;
    for (size_t at = 0; at < frames; at += kBlock) {
        const size_t len = std::min(kBlock, frames - at);
        block.resize(len * n);
        for (size_t i = 0; i < len; ++i)
            for (size_t c = 0; c < n; ++c) block[i * n + c] = chans[c][at + i];
        if (k7_resample_push(r.get(), block.data(), len, &got, &count, &error) != 0) throwError(error, "cannot resample");
        append(out, got, count);
    }
    if (k7_resample_finish(r.get(), &got, &count, &error) != 0) throwError(error, "cannot resample");
    append(out, got, count);
    return out;
}

#else

Decoded decodeForModel(const std::string&)
{
    throw std::runtime_error("this build has no stem separation: no audio decoder is built for this platform");
}

Channels resample(const Channels&, int, int)
{
    throw std::runtime_error("this build has no stem separation: no resampler is built for this platform");
}

#endif

}  // namespace k7::separation
