// Waveform.cpp — `--waveform <file>`: decode an audio file into a placement-independent peak+RMS envelope and
// cache it as `{file}.cache`, stamped with a fingerprint the file service recomputes byte-for-byte.
// Region slicing and the bar/beat grid stay in Node. See docs/cliModes.md.

#include "EngineHost.h"

#include "EngineTypes.h"  // Tracktion/JUCE + the te/tt/fs aliases

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace studio {

namespace {

// One envelope bucket per this many source frames, capped: a long file coarsens rather than growing without
// limit, while short one-shots keep near-full detail.
constexpr std::int64_t kFramesPerBucket = 256;
constexpr std::int64_t kMaxBuckets = 8192;
constexpr int kReadBlock = 1 << 16;  // frames per decode block

// --- content fingerprint (MUST match waveformCache.ts fileFingerprint) -------------
// FNV-1a/64 over the file SIZE then up to kHead bytes from the front and kTail from the end. It reads at most
// kHead+kTail bytes and depends only on content, never mtime, so Node computes the identical value. On a small
// file the two ranges overlap and both sides read the same overlapping bytes.
constexpr std::size_t kHead = 65536;
constexpr std::size_t kTail = 65536;

std::string fileFingerprint(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    in.seekg(0, std::ios::end);
    const std::int64_t size = in.tellg() < 0 ? 0 : static_cast<std::int64_t>(in.tellg());

    std::uint64_t h = 0xcbf29ce484222325ULL;  // FNV offset basis
    const std::uint64_t prime = 0x100000001b3ULL;
    const auto step = [&](unsigned char b) {
        h ^= static_cast<std::uint64_t>(b);
        h *= prime;
    };

    // Size as 8 little-endian bytes.
    std::uint64_t s = static_cast<std::uint64_t>(size);
    for (int k = 0; k < 8; ++k) {
        step(static_cast<unsigned char>(s & 0xff));
        s >>= 8;
    }

    std::vector<char> buf;
    // Head: [0, min(size, kHead)).
    const std::int64_t headLen = std::min<std::int64_t>(kHead, size);
    if (headLen > 0) {
        buf.resize(static_cast<std::size_t>(headLen));
        in.seekg(0, std::ios::beg);
        in.read(buf.data(), headLen);
        const std::streamsize got = in.gcount();
        for (std::streamsize i = 0; i < got; ++i) step(static_cast<unsigned char>(buf[i]));
    }
    // Tail: [max(0, size - kTail), size).
    const std::int64_t tailStart = size > static_cast<std::int64_t>(kTail) ? size - kTail : 0;
    const std::int64_t tailLen = size - tailStart;
    if (tailLen > 0) {
        buf.resize(static_cast<std::size_t>(tailLen));
        in.clear();
        in.seekg(tailStart, std::ios::beg);
        in.read(buf.data(), tailLen);
        const std::streamsize got = in.gcount();
        for (std::streamsize i = 0; i < got; ++i) step(static_cast<unsigned char>(buf[i]));
    }

    char hex[24];
    std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(h));
    return std::to_string(size) + "-" + hex;
}

// Append a [0,1] float to `out` with fixed precision (bounds sidecar size).
void appendFixed(std::string& out, float v) {
    char b[16];
    std::snprintf(b, sizeof(b), "%.4f", v);
    out += b;
}

}  // namespace

int writeWaveformCache(const std::string& audioPath) {
    const juce::File file{juce::String(audioPath)};
    if (!file.existsAsFile()) {
        std::cerr << "[waveform] no such file: " << audioPath << "\n";
        return 2;
    }

    juce::AudioFormatManager afm;
    afm.registerBasicFormats();  // wav, aiff, flac, ogg (+ platform mp3/m4a where built)
    std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(file)};
    if (!reader) {
        std::cerr << "[waveform] cannot decode: " << audioPath << "\n";
        return 2;
    }

    const std::int64_t frames = reader->lengthInSamples;
    const double sampleRate = reader->sampleRate > 0 ? reader->sampleRate : 48000.0;
    const int channels = static_cast<int>(reader->numChannels);
    const int useCh = std::min(channels, 2);  // mono-sum over the first 1–2 channels

    const std::int64_t buckets = frames <= 0
        ? 1
        : std::min<std::int64_t>(kMaxBuckets,
              std::max<std::int64_t>(1, (frames + kFramesPerBucket - 1) / kFramesPerBucket));
    std::vector<float> peak(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<double> sumSq(static_cast<std::size_t>(buckets), 0.0);
    std::vector<std::int64_t> count(static_cast<std::size_t>(buckets), 0);
    const double framesPerBucket = frames > 0
        ? static_cast<double>(frames) / static_cast<double>(buckets)
        : 1.0;

    juce::AudioBuffer<float> block(std::max(channels, 1), kReadBlock);
    std::int64_t pos = 0;
    while (pos < frames) {
        const int n = static_cast<int>(std::min<std::int64_t>(kReadBlock, frames - pos));
        reader->read(&block, 0, n, pos, true, true);
        for (int i = 0; i < n; ++i) {
            float sum = 0.0f;
            for (int c = 0; c < useCh; ++c) sum += block.getSample(c, i);
            const float v = sum / static_cast<float>(useCh);
            std::int64_t b = static_cast<std::int64_t>((static_cast<double>(pos + i)) / framesPerBucket);
            if (b >= buckets) b = buckets - 1;
            const float a = std::fabs(v);
            if (a > peak[static_cast<std::size_t>(b)]) peak[static_cast<std::size_t>(b)] = a;
            sumSq[static_cast<std::size_t>(b)] += static_cast<double>(v) * v;
            ++count[static_cast<std::size_t>(b)];
        }
        pos += n;
    }

    // Build the JSON sidecar by hand — arrays of thousands of floats, and no reason to pull a JSON library into
    // the engine library, which otherwise keeps none.
    std::string out;
    out.reserve(static_cast<std::size_t>(buckets) * 14 + 256);
    out += "{\"v\":1,\"fingerprint\":\"";
    out += fileFingerprint(audioPath);
    out += "\",\"sampleRate\":";
    out += std::to_string(static_cast<long long>(std::llround(sampleRate)));
    out += ",\"channels\":";
    out += std::to_string(channels);
    out += ",\"frames\":";
    out += std::to_string(static_cast<long long>(frames));
    char secs[32];
    std::snprintf(secs, sizeof(secs), "%.6f", frames / sampleRate);
    out += ",\"seconds\":";
    out += secs;
    out += ",\"peak\":[";
    for (std::size_t b = 0; b < peak.size(); ++b) {
        if (b) out += ',';
        appendFixed(out, peak[b]);
    }
    out += "],\"rms\":[";
    for (std::size_t b = 0; b < count.size(); ++b) {
        if (b) out += ',';
        const float rms = count[b] > 0
            ? static_cast<float>(std::sqrt(sumSq[b] / static_cast<double>(count[b])))
            : 0.0f;
        appendFixed(out, rms);
    }
    out += "]}";

    const std::string cachePath = audioPath + ".cache";
    std::ofstream os(cachePath, std::ios::binary | std::ios::trunc);
    if (!os) {
        std::cerr << "[waveform] cannot write cache: " << cachePath << "\n";
        return 2;
    }
    os.write(out.data(), static_cast<std::streamsize>(out.size()));
    os.close();
    if (!os) {
        std::cerr << "[waveform] failed writing cache: " << cachePath << "\n";
        return 2;
    }
    return 0;
}

}  // namespace studio
