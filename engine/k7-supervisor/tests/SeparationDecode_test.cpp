// SeparationDecode_test.cpp — the decode a stem cut starts from: any file comes back stereo at the
// model's rate with the file's own rate said, a stem goes back at the ratio's length, and what is not
// audio fails with a reason rather than taking the process down.

#include "SeparationDecode.h"

#include "Paths.h"
#include "test_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <stdexcept>

using namespace k7::separation;
namespace fs = std::filesystem;

namespace {

fs::path folder()
{
    const auto dir = fs::temp_directory_path() / ("k7-decode-" + std::to_string(std::rand()));
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

std::vector<float> sine(int rate, size_t frames)
{
    std::vector<float> s(frames);
    for (size_t i = 0; i < frames; ++i) s[i] = 0.5f * static_cast<float>(std::sin(2 * 3.14159265358979323846 * 440.0 * static_cast<double>(i) / rate));
    return s;
}

std::string save(const fs::path& path, const std::string& bytes)
{
    std::ofstream(path, std::ios::binary | std::ios::trunc) << bytes;
    return k7::paths::utf8(path);
}

bool throws(const std::string& path)
{
    try {
        decodeForModel(path);
    } catch (const std::exception& e) {
        return std::string(e.what()).size() > 0;
    }
    return false;
}

#ifdef K7_WITH_DECODER

void aMonoFileComesBackOnBothSides()
{
    const auto dir = folder();
    const auto tone = sine(kSampleRate, 5000);
    const auto d = decodeForModel(save(dir / "mono.wav", wavPcm24({tone}, kSampleRate)));
    CHECK(d.sourceRate == kSampleRate);
    CHECK(d.channels.size() == 2);
    CHECK(d.channels[0].size() == tone.size());
    CHECK(d.channels[1] == d.channels[0]);
    float worst = 0;
    for (size_t i = 0; i < tone.size(); ++i) worst = std::max(worst, std::abs(d.channels[0][i] - tone[i]));
    CHECK(worst < 1e-6);
    fs::remove_all(dir);
}

void aFileAtAnotherRateReachesTheModelsAndSaysItsOwn()
{
    const auto dir = folder();
    const auto tone = sine(48000, 48000);
    const auto d = decodeForModel(save(dir / "48k.wav", wavPcm24({tone, tone}, 48000)));
    CHECK(d.sourceRate == 48000);
    CHECK(d.channels.size() == 2);
    CHECK(d.channels[0].size() == 44100);
    const auto want = sine(kSampleRate, 44100);
    float worst = 0;
    for (size_t i = 5000; i < 40000; ++i) worst = std::max(worst, std::abs(d.channels[1][i] - want[i]));
    CHECK(worst < 1e-3);
    fs::remove_all(dir);
}

void aStemGoesBackAtTheRatiosLength()
{
    const auto tone = sine(kSampleRate, 100000);
    const auto out = resample({tone, tone}, kSampleRate, 48000);
    CHECK(out.size() == 2);
    CHECK(out[0].size() == static_cast<size_t>(std::ceil(100000.0 * 48000 / kSampleRate)));
    const auto want = sine(48000, out[0].size());
    float worst = 0;
    for (size_t i = 5000; i < 90000; ++i) worst = std::max(worst, std::abs(out[0][i] - want[i]));
    CHECK(worst < 1e-3);
}

void whatIsNotAudioFailsWithAReason()
{
    const auto dir = folder();
    CHECK(throws(save(dir / "text.wav", "this is not a wav file at all")));
    CHECK(throws(k7::paths::utf8(dir / "absent.mp3")));
    fs::remove_all(dir);
}

#else

void aBuildWithoutTheDecoderSaysSo()
{
    CHECK(throws("song.mp3"));
}

#endif

}  // namespace

void runSeparationDecodeTests()
{
#ifdef K7_WITH_DECODER
    RUN(aMonoFileComesBackOnBothSides);
    RUN(aFileAtAnotherRateReachesTheModelsAndSaysItsOwn);
    RUN(aStemGoesBackAtTheRatiosLength);
    RUN(whatIsNotAudioFailsWithAReason);
#else
    RUN(aBuildWithoutTheDecoderSaysSo);
#endif
}
