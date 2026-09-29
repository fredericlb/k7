// Waveform.cpp — `--waveform <file> [<sensitivity>]`: decode an audio file into a placement-independent
// peak+RMS envelope and a three-band one, detect its transient onsets and estimate its tempo, and cache as
// `{file}.cache`, stamped with a fingerprint the file service recomputes byte-for-byte.
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

// The two corners that split the envelope into three complementary bands, for COLOUR rather than for sound — docs/cliModes.md.
constexpr double kBandLowHz = 200.0;
constexpr double kBandHighHz = 4000.0;
constexpr double kTwoPi = 6.283185307179586;

// One envelope bucket per this many source frames, capped so a long file coarsens while short one-shots keep near-full detail.
constexpr std::int64_t kFramesPerBucket = 256;
constexpr std::int64_t kMaxBuckets = 8192;
constexpr int kReadBlock = 1 << 16;  // frames per decode block

// Content fingerprint, FNV-1a/64 over the file SIZE then kHead bytes from the front and kTail from the end — MUST match waveformCache.ts fileFingerprint.
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

// Bucket indices where the peak envelope JUMPS, mean + sensitivity*stddev of the first derivative — MUST match @studio/audio-probe's detectTransients, docs/cliModes.md.
constexpr int kMinTransientGap = 3;  // buckets, so one attack is not counted twice

std::vector<std::size_t> detectTransients(const std::vector<float>& peak, double sensitivity) {
    if (peak.size() < 3) return {};
    std::vector<double> diffs;
    diffs.reserve(peak.size() - 1);
    for (std::size_t i = 1; i < peak.size(); ++i)
        diffs.push_back(static_cast<double>(peak[i]) - static_cast<double>(peak[i - 1]));
    if (diffs.empty()) return {};

    double sum = 0.0;
    for (const double d : diffs) sum += d;
    const double mean = sum / static_cast<double>(diffs.size());
    double ssq = 0.0;
    for (const double d : diffs) ssq += (d - mean) * (d - mean);
    const double std = std::sqrt(ssq / static_cast<double>(diffs.size()));
    const double threshold = mean + sensitivity * std;

    std::vector<std::size_t> result;
    std::int64_t lastIdx = -kMinTransientGap;
    for (std::size_t i = 0; i < diffs.size(); ++i) {
        const std::int64_t idx = static_cast<std::int64_t>(i);
        if (diffs[i] > threshold && idx - lastIdx >= kMinTransientGap) {
            result.push_back(i + 1);  // +1: the bucket AFTER the jump is the transient onset
            lastIdx = idx + 1;
        }
    }
    return result;
}

// --- tempo: the musical range a detected tempo is allowed to land in ---------------------------
constexpr double kMinBpm = 60.0;
constexpr double kMaxBpm = 200.0;
// A tempo PRIOR and not a fold — Ellis's Gaussian weighting in log2-tempo, centred here, measured in docs/cliModes.md.
constexpr double kPriorCentreBpm = 120.0;
constexpr double kPriorOctaves = 1.0;  // sigma, in octaves

// Tempo by autocorrelation over a FIXED-rate onset envelope, or 0 when nothing correlates — never a guess, docs/cliModes.md.
double detectBpm(const std::vector<float>& onset, double rate) {
    if (onset.size() < 16 || rate <= 0.0) return 0.0;

    // Mean-remove, so a loud passage does not simply correlate with itself.
    double mean = 0.0;
    for (const float v : onset) mean += v;
    mean /= static_cast<double>(onset.size());
    std::vector<double> x(onset.size());
    for (std::size_t i = 0; i < onset.size(); ++i) x[i] = static_cast<double>(onset[i]) - mean;

    const std::int64_t minLag = static_cast<std::int64_t>(std::floor(rate * 60.0 / kMaxBpm));
    const std::int64_t maxLag = static_cast<std::int64_t>(std::ceil(rate * 60.0 / kMinBpm));
    if (minLag < 1 || maxLag <= minLag || static_cast<std::size_t>(maxLag) >= x.size()) return 0.0;

    // Normalised by the overlap, or a short lag wins for having more terms to add up.
    const auto corr = [&](std::int64_t lag) {
        double sum = 0.0;
        const std::size_t n = x.size() - static_cast<std::size_t>(lag);
        for (std::size_t i = 0; i < n; ++i) sum += x[i] * x[i + static_cast<std::size_t>(lag)];
        return sum / static_cast<double>(n);
    };
    const auto prior = [&](std::int64_t lag) {
        const double bpm = 60.0 * rate / static_cast<double>(lag);
        const double oct = std::log2(bpm / kPriorCentreBpm) / kPriorOctaves;
        return std::exp(-0.5 * oct * oct);
    };

    double best = 0.0;
    std::int64_t bestLag = 0;
    for (std::int64_t lag = minLag; lag <= maxLag; ++lag) {
        const double score = corr(lag) * prior(lag);
        if (score > best) {
            best = score;
            bestLag = lag;
        }
    }
    if (bestLag <= 0 || best <= 0.0) return 0.0;

    // Parabolic interpolation around the winning lag: at 187 Hz a whole-sample lag is ~1 bpm at 120, and 119 for 120 drifts every derived grid.
    double lagF = static_cast<double>(bestLag);
    if (bestLag > minLag && bestLag < maxLag) {
        const double ym1 = corr(bestLag - 1) * prior(bestLag - 1);
        const double y0 = best;
        const double yp1 = corr(bestLag + 1) * prior(bestLag + 1);
        const double denom = ym1 - 2.0 * y0 + yp1;
        if (std::fabs(denom) > 1e-12) {
            const double shift = 0.5 * (ym1 - yp1) / denom;
            if (std::fabs(shift) <= 1.0) lagF += shift;
        }
    }

    const double bpm = 60.0 * rate / lagF;
    if (bpm < kMinBpm || bpm > kMaxBpm) return 0.0;
    // What the prior fixes, what it does not, and the three measurements behind the choice: docs/cliModes.md.
    return std::round(bpm * 100.0) / 100.0;
}

}  // namespace

int writeWaveformCache(const std::string& audioPath, double transientSensitivity) {
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
    // A header is not trusted to size the buffers below: no channel is a division by zero, and a length past twelve hours is a corrupt file, not a song.
    constexpr double kMaxSeconds = 12 * 3600.0;
    if (channels <= 0 || static_cast<double>(frames) > kMaxSeconds * sampleRate) {
        std::cerr << "[waveform] implausible header (" << channels << " channel(s), " << frames
                  << " frames): " << audioPath << "\n";
        return 2;
    }
    const int useCh = std::min(channels, 2);  // mono-sum over the first 1–2 channels

    const std::int64_t buckets = frames <= 0
        ? 1
        : std::min<std::int64_t>(kMaxBuckets,
              std::max<std::int64_t>(1, (frames + kFramesPerBucket - 1) / kFramesPerBucket));
    std::vector<float> peak(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<double> sumSq(static_cast<std::size_t>(buckets), 0.0);
    std::vector<std::int64_t> count(static_cast<std::size_t>(buckets), 0);
    // One peak per band per bucket, peaks and not RMS: a kick is an attack, and averaging one over a bucket loses the thing being shown.
    std::vector<float> lowPk(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<float> midPk(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<float> highPk(static_cast<std::size_t>(buckets), 0.0f);
    // Two one-pole followers whose differences are the three bands, their state carried across read blocks so no band restarts every 64k frames.
    const float aLow = static_cast<float>(1.0 - std::exp(-kTwoPi * kBandLowHz / sampleRate));
    const float aHigh = static_cast<float>(1.0 - std::exp(-kTwoPi * kBandHighHz / sampleRate));
    float lpLow = 0.0f;
    float lpHigh = 0.0f;
    const double framesPerBucket = frames > 0
        ? static_cast<double>(frames) / static_cast<double>(buckets)
        : 1.0;

    // A SECOND envelope for tempo alone, at a fixed hop whatever the length — ~187 Hz at 48k, about 220 KB of float for five minutes (docs/cliModes.md).
    const std::int64_t tempoHops = frames > 0 ? (frames + kFramesPerBucket - 1) / kFramesPerBucket : 0;
    std::vector<float> tempoEnv(static_cast<std::size_t>(std::max<std::int64_t>(tempoHops, 0)), 0.0f);
    const double tempoRate = sampleRate / static_cast<double>(kFramesPerBucket);

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

            // The split: `lpLow` is everything under 200 Hz and `lpHigh` everything under 4 k, so the middle and the top are subtractions that add back to `v`.
            lpLow += aLow * (v - lpLow);
            lpHigh += aHigh * (v - lpHigh);
            const std::size_t bi = static_cast<std::size_t>(b);
            const float lo = std::fabs(lpLow);
            const float md = std::fabs(lpHigh - lpLow);
            const float hi = std::fabs(v - lpHigh);
            if (lo > lowPk[bi]) lowPk[bi] = lo;
            if (md > midPk[bi]) midPk[bi] = md;
            if (hi > highPk[bi]) highPk[bi] = hi;
            sumSq[static_cast<std::size_t>(b)] += static_cast<double>(v) * v;
            ++count[static_cast<std::size_t>(b)];

            const std::int64_t h = (pos + i) / kFramesPerBucket;
            if (h >= 0 && h < static_cast<std::int64_t>(tempoEnv.size()) &&
                a > tempoEnv[static_cast<std::size_t>(h)])
                tempoEnv[static_cast<std::size_t>(h)] = a;
        }
        pos += n;
    }

    // Half-wave-rectified first difference, because a beat is where energy RISES: the raw envelope correlates a sustained note with itself.
    for (std::size_t i = tempoEnv.size(); i-- > 1;)
        tempoEnv[i] = std::max(0.0f, tempoEnv[i] - tempoEnv[i - 1]);
    if (!tempoEnv.empty()) tempoEnv[0] = 0.0f;
    const double bpm = detectBpm(tempoEnv, tempoRate);

    // Build the JSON sidecar by hand: arrays of thousands of floats, and no reason to pull a JSON library into a library that keeps none.
    std::string out;
    out.reserve(static_cast<std::size_t>(buckets) * 14 + 256);
    // v2 added `transients` + `sensitivity`, v3 `bpm`, v4 the three bands; waveformCache.ts REQUIRES the current one, or an old sidecar reads as fresh for ever.
    out += "{\"v\":4,\"fingerprint\":\"";
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
    // The three bands, in the same bucket space as `peak`, so a consumer indexes all four the same way.
    out += "],\"low\":[";
    for (std::size_t b = 0; b < lowPk.size(); ++b) {
        if (b) out += ',';
        appendFixed(out, lowPk[b]);
    }
    out += "],\"mid\":[";
    for (std::size_t b = 0; b < midPk.size(); ++b) {
        if (b) out += ',';
        appendFixed(out, midPk[b]);
    }
    out += "],\"high\":[";
    for (std::size_t b = 0; b < highPk.size(); ++b) {
        if (b) out += ',';
        appendFixed(out, highPk[b]);
    }
    // 0 means "no tempo found" — silence, one sustained note, free time — and never a guess, since every later grid trusts this number.
    out += "],\"bpm\":";
    char bpmBuf[32];
    std::snprintf(bpmBuf, sizeof(bpmBuf), "%.2f", bpm);
    out += bpmBuf;
    out += ",\"sensitivity\":";
    char sens[32];
    std::snprintf(sens, sizeof(sens), "%.4f", transientSensitivity);
    out += sens;
    // Onsets in FILE seconds rather than bucket indices, since seconds survive a change of bucket density that indices would not.
    out += ",\"transients\":[";
    {
        const std::vector<std::size_t> onsets = detectTransients(peak, transientSensitivity);
        const double fileSeconds = sampleRate > 0 ? frames / sampleRate : 0.0;
        for (std::size_t i = 0; i < onsets.size(); ++i) {
            if (i) out += ',';
            const double t = peak.empty()
                ? 0.0
                : (static_cast<double>(onsets[i]) / static_cast<double>(peak.size())) * fileSeconds;
            char tb[32];
            std::snprintf(tb, sizeof(tb), "%.6f", t);
            out += tb;
        }
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
