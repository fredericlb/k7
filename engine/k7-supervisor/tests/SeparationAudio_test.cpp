// SeparationAudio_test.cpp — the cases of stem-separation's separateAudio.test.ts: the windows cover
// the file and end on its end, overlap-add gives back what it was fed, and the WAV is 24-bit PCM that
// clamps rather than wraps.

#include "SeparationAudio.h"

#include "test_harness.h"

#include <cmath>
#include <cstdint>

using namespace k7::separation;

namespace {

int32_t sampleAt(const std::string& b, size_t i)
{
    const size_t o = 44 + i * 3;
    const uint32_t u = uint8_t(b[o]) | (uint32_t(uint8_t(b[o + 1])) << 8) | (uint32_t(uint8_t(b[o + 2])) << 16);
    return (u & 0x800000) ? int32_t(u) - 0x1000000 : int32_t(u);
}

void oneWindowForAShortFile()
{
    CHECK(windowStarts(1000) == std::vector<size_t>{0});
    CHECK(windowStarts(kSegment) == std::vector<size_t>{0});
}

void theLastWindowEndsOnTheEnd()
{
    const size_t len = kSegment * 3 + 12345;
    const auto starts = windowStarts(len);
    CHECK(starts.back() + kSegment == len);
    CHECK(starts.front() == 0);
    for (size_t i = 1; i < starts.size(); ++i) CHECK(starts[i] <= starts[i - 1] + kSegment);
}

void theTriangleIsNeverZero()
{
    const auto w = triangle(101);
    float least = 1;
    for (float v : w) least = std::min(least, v);
    CHECK(least > 0);
    CHECK(std::abs(w[50] - 1) < 1e-5);
}

void overlapAddReconstructs()
{
    const size_t len = kSegment * 2 + 5000;
    std::vector<float> source(len);
    for (size_t i = 0; i < len; ++i) source[i] = std::sin(static_cast<float>(i) / 500);
    OverlapAdd oa(len, 1);
    for (size_t at : windowStarts(len)) {
        oa.add(at, 0, 0, source.data() + at, std::min(kSegment, len - at));
        oa.countWindow(at);
    }
    const auto out = oa.finish(0)[0];
    float worst = 0;
    for (size_t i = 0; i < len; ++i) worst = std::max(worst, std::abs(out[i] - source[i]));
    CHECK(worst < 1e-5);
}

void eachStemKeepsItsOwn()
{
    OverlapAdd oa(kSegment, kStems.size());
    std::vector<float> ones(kSegment, 1);
    oa.add(0, 2, 0, ones.data(), kSegment);
    oa.countWindow(0);
    CHECK(std::abs(oa.finish(2)[0][kSegment >> 1] - 1) < 1e-5);
    CHECK(oa.finish(0)[0][kSegment >> 1] == 0);
}

void deinterleavesFfmpegFrames()
{
    const auto c = deinterleave({1, -1, 2, -2, 3, -3}, 2);
    CHECK((c[0] == std::vector<float>{1, 2, 3}));
    CHECK((c[1] == std::vector<float>{-1, -2, -3}));
}

void theWavIs24BitPcm()
{
    const auto b = wavPcm24({{0, 0.5f, -0.5f}, {1, -1, 0}});
    CHECK(b.substr(0, 4) == "RIFF");
    CHECK(b.substr(8, 4) == "WAVE");
    CHECK(b.size() == 44 + 3 * 2 * 3);
    CHECK(uint8_t(b[34]) == 24);
    CHECK(sampleAt(b, 1) == 0x7fffff);
    CHECK(sampleAt(b, 3) == -0x7fffff);
}

void anOvershootIsClamped()
{
    const auto b = wavPcm24({{2, -2}});
    CHECK(sampleAt(b, 0) == 0x7fffff);
    CHECK(sampleAt(b, 1) == -0x800000);
}

void theInstrumentalIsEverythingButTheVoice()
{
    OverlapAdd oa(kSegment, kStems.size());
    std::vector<float> ones(kSegment, 1);
    for (size_t s = 0; s < kStems.size(); ++s)
        for (size_t c = 0; c < 2; ++c) oa.add(0, s, c, ones.data(), kSegment);
    oa.countWindow(0);
    CHECK(std::abs(outputChannels(oa, kInstrumental)[0][kSegment >> 1] - 3) < 1e-4);
    CHECK(std::abs(peakOf(outputChannels(oa, "vocals")) - 1) < 1e-4);
}

}  // namespace

void runSeparationAudioTests()
{
    RUN(oneWindowForAShortFile);
    RUN(theLastWindowEndsOnTheEnd);
    RUN(theTriangleIsNeverZero);
    RUN(overlapAddReconstructs);
    RUN(eachStemKeepsItsOwn);
    RUN(deinterleavesFfmpegFrames);
    RUN(theWavIs24BitPcm);
    RUN(anOvershootIsClamped);
    RUN(theInstrumentalIsEverythingButTheVoice);
}
