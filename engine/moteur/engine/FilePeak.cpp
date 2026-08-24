// FilePeak.cpp — `--peak <file>`: the TRUE peak of an audio file, printed as JSON. The measurement a cold
// module needs before a render, and the one thing the waveform sidecar cannot give: that envelope is a mono
// SUM, rounded to four decimals, so a peak living on one channel reads up to 6 dB low there.
// See docs/cliModes.md and packages/song/docs/coldModules.md.

#include "EngineHost.h"

#include "EngineTypes.h"  // Tracktion/JUCE + the te/tt/fs aliases

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>

namespace studio {

namespace {
// Read in blocks rather than loading the file: this only ever MEASURES, and a running max needs one block at a time however long the master is.
constexpr int kReadBlock = 1 << 16;

// dBFS of a linear magnitude; silence has no dB and is reported as the floor the `Peak` param declares, which makes a silent file a no-op.
constexpr double kFloorDb = -100.0;

double toDb(double linear) {
    if (!(linear > 0.0)) return kFloorDb;
    return std::max(kFloorDb, 20.0 * std::log10(linear));
}
}  // namespace

int printFilePeak(const std::string& audioPath) {
    juce::AudioFormatManager afm;
    afm.registerBasicFormats();  // wav/aiff/flac/ogg (+ platform mp3/m4a where built)

    const juce::File f{juce::String(audioPath)};
    std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(f)};
    if (!reader) {
        std::cerr << "[peak] cannot decode: " << audioPath << "\n";
        return 2;
    }

    const int channels = std::max(1, static_cast<int>(reader->numChannels));
    const std::int64_t frames = reader->lengthInSamples;
    const double sampleRate = reader->sampleRate > 0 ? reader->sampleRate : 48000.0;

    // getMagnitude is across ALL channels, which is the whole point: the loudest sample anywhere decides the gain, and averaging first would hide it.
    juce::AudioBuffer<float> block(channels, kReadBlock);
    float peak = 0.0f;
    for (std::int64_t pos = 0; pos < frames;) {
        const int n = static_cast<int>(std::min<std::int64_t>(kReadBlock, frames - pos));
        reader->read(&block, 0, n, pos, true, true);
        peak = std::max(peak, block.getMagnitude(0, n));
        pos += n;
    }

    // A float file may exceed full scale and is reported as measured: rounding here would be this file inventing a policy the module owns.
    char out[256];
    std::snprintf(out, sizeof(out),
                  "{\"peak\":%.9f,\"peakDb\":%.4f,\"frames\":%lld,\"channels\":%d,\"sampleRate\":%.0f}\n",
                  static_cast<double>(peak), toDb(static_cast<double>(peak)),
                  static_cast<long long>(frames), channels, sampleRate);
    std::cout << out << std::flush;
    return 0;
}

}  // namespace studio
