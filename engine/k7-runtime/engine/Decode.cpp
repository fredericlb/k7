// Decode.cpp — `--decode <file>`: any format JUCE reads, as one JSON header line on stdout then the
// frames as interleaved float32 little-endian, every channel. Everything MEASURED from them — the
// `{file}.cache` sidecar, a true peak — is @studio/audio-analysis's; this only decodes. See docs/cliModes.md.

#include "EngineHost.h"

#include "EngineTypes.h"  // Tracktion/JUCE + the te/tt/fs aliases

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#endif

namespace studio {

namespace {
constexpr int kReadBlock = 1 << 16;  // frames per decode block
// A header is not trusted to size anything: these bound what a real file has, and past them it is a corrupt one.
constexpr double kMaxSeconds = 12 * 3600.0;
constexpr int kMaxChannels = 32;
constexpr double kMaxSampleRate = 768000.0;
}  // namespace

int decodeToStdout(const std::string& audioPath) {
    juce::AudioFormatManager afm;
    afm.registerBasicFormats();  // wav, aiff, flac, ogg (+ platform mp3/m4a where built)
    std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(juce::File{juce::String(audioPath)})};
    if (!reader) {
        std::cerr << "[decode] cannot decode: " << audioPath << "\n";
        return 2;
    }

    const std::int64_t frames = std::max<std::int64_t>(0, reader->lengthInSamples);
    const double sampleRate = reader->sampleRate > 0 ? reader->sampleRate : 48000.0;
    const int channels = static_cast<int>(reader->numChannels);
    // The rate is checked before it scales the length cap, or a huge rate would let a huge length through.
    if (channels <= 0 || channels > kMaxChannels || sampleRate > kMaxSampleRate ||
        static_cast<double>(frames) > kMaxSeconds * sampleRate) {
        std::cerr << "[decode] implausible header (" << channels << " channel(s), " << frames
                  << " frames): " << audioPath << "\n";
        return 2;
    }

#if defined(_WIN32)
    // Text mode would turn every 0x0A byte of a sample into 0x0D 0x0A.
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::fprintf(stdout, "{\"sampleRate\":%.0f,\"channels\":%d,\"frames\":%lld}\n", sampleRate, channels,
                 static_cast<long long>(frames));

    juce::AudioBuffer<float> block(channels, kReadBlock);
    std::vector<float> interleaved(static_cast<std::size_t>(kReadBlock) * static_cast<std::size_t>(channels));
    for (std::int64_t pos = 0; pos < frames;) {
        const int n = static_cast<int>(std::min<std::int64_t>(kReadBlock, frames - pos));
        reader->read(&block, 0, n, pos, true, true);
        for (int c = 0; c < channels; ++c) {
            const float* src = block.getReadPointer(c);
            for (int i = 0; i < n; ++i) interleaved[static_cast<std::size_t>(i * channels + c)] = src[i];
        }
        const std::size_t count = static_cast<std::size_t>(n) * static_cast<std::size_t>(channels);
        // A reader that went away mid-stream — the pipe closed — is not this process's to retry.
        if (std::fwrite(interleaved.data(), sizeof(float), count, stdout) != count) return 3;
        pos += n;
    }
    std::fflush(stdout);
    return 0;
}

}  // namespace studio
