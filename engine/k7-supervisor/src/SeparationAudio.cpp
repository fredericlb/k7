// SeparationAudio.cpp — see SeparationAudio.h.

#include "SeparationAudio.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace k7::separation {

std::vector<size_t> windowStarts(size_t length)
{
    if (length <= kSegment) return {0};
    std::vector<size_t> starts;
    for (size_t at = 0; at + kSegment < length; at += kHop) starts.push_back(at);
    starts.push_back(length - kSegment);
    return starts;
}

std::vector<float> triangle(size_t n)
{
    std::vector<float> w(n);
    const double half = (static_cast<double>(n) - 1) / 2;
    for (size_t i = 0; i < n; ++i)
        w[i] = static_cast<float>(std::max(1.0 / static_cast<double>(n), 1 - std::abs(static_cast<double>(i) - half) / half));
    return w;
}

OverlapAdd::OverlapAdd(size_t length, size_t stems)
    : length_(length), acc_(stems, Channels(kChannels, std::vector<float>(length))), weight_(length), win_(triangle())
{
}

void OverlapAdd::add(size_t at, size_t stem, size_t channel, const float* samples, size_t n)
{
    auto& dst = acc_[stem][channel];
    const size_t m = std::min(n, length_ - at);
    for (size_t i = 0; i < m; ++i) dst[at + i] += samples[i] * win_[i];
}

void OverlapAdd::countWindow(size_t at)
{
    const size_t m = std::min(kSegment, length_ - at);
    for (size_t i = 0; i < m; ++i) weight_[at + i] += win_[i];
}

Channels OverlapAdd::finish(size_t stem) const
{
    Channels out(acc_[stem].size(), std::vector<float>(length_));
    for (size_t c = 0; c < out.size(); ++c)
        for (size_t i = 0; i < length_; ++i) out[c][i] = weight_[i] > 0 ? acc_[stem][c][i] / weight_[i] : 0;
    return out;
}

float peakOf(const Channels& chans)
{
    float peak = 0;
    for (const auto& ch : chans)
        for (float v : ch) peak = std::max(peak, std::abs(v));
    return peak;
}

std::string wavPcm24(const Channels& chans, int sampleRate)
{
    constexpr int kBytes = 3;
    constexpr int32_t kFullScale = 0x7fffff;
    const uint32_t frames = chans.empty() ? 0 : static_cast<uint32_t>(chans[0].size());
    const uint32_t n = static_cast<uint32_t>(chans.size());
    const uint32_t dataBytes = frames * n * kBytes;
    std::string buf;
    buf.reserve(44 + dataBytes);
    auto u32 = [&](uint32_t v) {
        for (int i = 0; i < 4; ++i) buf.push_back(static_cast<char>((v >> (8 * i)) & 0xff));
    };
    auto u16 = [&](uint16_t v) {
        buf.push_back(static_cast<char>(v & 0xff));
        buf.push_back(static_cast<char>(v >> 8));
    };
    buf += "RIFF";
    u32(36 + dataBytes);
    buf += "WAVEfmt ";
    u32(16);
    u16(1);
    u16(static_cast<uint16_t>(n));
    u32(static_cast<uint32_t>(sampleRate));
    u32(static_cast<uint32_t>(sampleRate) * n * kBytes);
    u16(static_cast<uint16_t>(n * kBytes));
    u16(24);
    buf += "data";
    u32(dataBytes);
    for (uint32_t i = 0; i < frames; ++i)
        for (uint32_t c = 0; c < n; ++c) {
            const double scaled = std::round(static_cast<double>(chans[c][i]) * kFullScale);
            const int32_t s = static_cast<int32_t>(std::clamp(scaled, -8388608.0, static_cast<double>(kFullScale)));
            const uint32_t u = static_cast<uint32_t>(s) & 0xffffff;
            buf.push_back(static_cast<char>(u & 0xff));
            buf.push_back(static_cast<char>((u >> 8) & 0xff));
            buf.push_back(static_cast<char>((u >> 16) & 0xff));
        }
    return buf;
}

Channels outputChannels(const OverlapAdd& oa, const std::string& name)
{
    auto index = [](const std::string& stem) {
        return static_cast<size_t>(std::find(kStems.begin(), kStems.end(), stem) - kStems.begin());
    };
    if (name != kInstrumental) return oa.finish(index(name));
    // Added one at a time rather than held four deep: a five-minute stem is 105 MB of floats.
    Channels sum;
    for (const auto& stem : kStems) {
        if (stem == "vocals") continue;
        auto part = oa.finish(index(stem));
        if (sum.empty()) {
            sum = std::move(part);
            continue;
        }
        for (size_t c = 0; c < sum.size(); ++c)
            for (size_t i = 0; i < sum[c].size(); ++i) sum[c][i] += part[c][i];
    }
    return sum;
}

}  // namespace k7::separation
