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

// One envelope bucket per this many source frames, capped: a long file coarsens rather than growing without
// limit, while short one-shots keep near-full detail.
// The two corners that split the envelope into three bands, for COLOUR rather than for sound.
// 200 Hz keeps kick and bass on one side; 4 kHz puts cymbals and the top of a hi-hat on the
// other; what is left in the middle is where voices and snares live. A drawing does not need
// steep filters — it needs the three to be complementary, which one-poles are by construction:
// low + mid + high sums back to the signal exactly, so a column's colour cannot invent energy.
constexpr double kBandLowHz = 200.0;
constexpr double kBandHighHz = 4000.0;
constexpr double kTwoPi = 6.283185307179586;

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

// --- transient detection (MUST match detectTransients in @studio/commands/waveform.ts) ---------
// Bucket indices where the peak envelope JUMPS: mean + sensitivity*stddev of the first derivative. It runs here,
// on the file's own envelope at its native resolution, rather than per clip region on a resampled one — the same
// audio then reads the same onsets wherever it is drawn, and a region cannot invent detail the envelope lacks.
// See docs/cliModes.md.
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

// --- tempo -------------------------------------------------------------------------------------
// The musical range a detected tempo is allowed to land in.
constexpr double kMinBpm = 60.0;
constexpr double kMaxBpm = 200.0;
// A tempo PRIOR, not a fold: correlation is weighted by a Gaussian in log2-tempo centred here, so a
// musically ordinary tempo beats its own half or double unless the audio really insists. This is Ellis's
// weighting, and it is what an autocorrelation needs to stop reporting half-time — measured below.
constexpr double kPriorCentreBpm = 120.0;
constexpr double kPriorOctaves = 1.0;  // sigma, in octaves

/**
 * Tempo from an onset-strength envelope, by autocorrelation.
 *
 * `onset` is half-wave-rectified first difference at a FIXED rate (see the decode loop), not the stored
 * `peak` envelope: that one is capped at kMaxBuckets, so a five-minute track would land at ~27 Hz and a
 * beat would be a dozen samples wide — far too coarse to place a tempo. Detection needs uniform time
 * resolution, which is a different requirement from drawing.
 *
 * Returns 0 when nothing correlates — silence, one sustained note, free time. A zero is written as "no
 * tempo", never as a guess, because a wrong bpm in a sidecar is worse than an absent one: it is the
 * number every later grid trusts.
 */
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

    // Parabolic interpolation around the winning lag: at 187 Hz a whole-sample lag is ~1 bpm at 120,
    // and a tempo that reads 119 when it is 120 makes every derived grid drift.
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
    // A PRIOR and not a fold, and the difference was measured. Hard-folding into a "tempo people tap"
    // window (80–160) reported 174 as 87 and 75 as 150 — it broke both cases it was meant to help. With no
    // weighting at all, raw autocorrelation reported 140 as 70: for a periodic signal the double lag
    // correlates about as well, since every second beat lands on it.
    //
    // The prior settles that by preference rather than by decree, and a tempo far from 120 can still win
    // if the audio insists. What it does NOT fix is the far end: 174 still reads 87, because at one octave
    // out the prior favours 87 and nothing in an autocorrelation can tell a genre apart. That is a known
    // limit of this class of detector, and it is acceptable here only because the number is a STARTING
    // POINT the person edits in song.yaml.
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
    const int useCh = std::min(channels, 2);  // mono-sum over the first 1–2 channels

    const std::int64_t buckets = frames <= 0
        ? 1
        : std::min<std::int64_t>(kMaxBuckets,
              std::max<std::int64_t>(1, (frames + kFramesPerBucket - 1) / kFramesPerBucket));
    std::vector<float> peak(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<double> sumSq(static_cast<std::size_t>(buckets), 0.0);
    std::vector<std::int64_t> count(static_cast<std::size_t>(buckets), 0);
    // One peak per band per bucket — what a coloured waveform is drawn from. Peaks and not RMS
    // for the same reason the main envelope uses them: a kick is an attack, and averaging it
    // over a bucket is exactly how you lose the thing you were trying to show.
    std::vector<float> lowPk(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<float> midPk(static_cast<std::size_t>(buckets), 0.0f);
    std::vector<float> highPk(static_cast<std::size_t>(buckets), 0.0f);
    // Two one-pole followers, and the three bands are their differences. State carried across
    // read blocks, so a band does not restart at every 64k frames.
    const float aLow = static_cast<float>(1.0 - std::exp(-kTwoPi * kBandLowHz / sampleRate));
    const float aHigh = static_cast<float>(1.0 - std::exp(-kTwoPi * kBandHighHz / sampleRate));
    float lpLow = 0.0f;
    float lpHigh = 0.0f;
    const double framesPerBucket = frames > 0
        ? static_cast<double>(frames) / static_cast<double>(buckets)
        : 1.0;

    // A SECOND envelope, at a fixed hop and therefore a fixed rate, for tempo alone. The one above is
    // capped at kMaxBuckets so a long file coarsens — right for drawing, useless for finding a beat,
    // where a five-minute track would land at ~27 Hz. This one stays at sampleRate/kFramesPerBucket
    // whatever the length: ~187 Hz at 48k, about 220 KB of float for a five-minute track.
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

            // The split. `lpLow` is everything under 200 Hz, `lpHigh` everything under 4 k, so
            // the middle is one subtraction and the top is another — and the three add back up
            // to `v` exactly.
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

    // Half-wave-rectified first difference: a beat is where energy RISES. Keeping the raw envelope would
    // correlate a sustained note with itself and report its length as the tempo.
    for (std::size_t i = tempoEnv.size(); i-- > 1;)
        tempoEnv[i] = std::max(0.0f, tempoEnv[i] - tempoEnv[i - 1]);
    if (!tempoEnv.empty()) tempoEnv[0] = 0.0f;
    const double bpm = detectBpm(tempoEnv, tempoRate);

    // Build the JSON sidecar by hand — arrays of thousands of floats, and no reason to pull a JSON library into
    // the engine library, which otherwise keeps none.
    std::string out;
    out.reserve(static_cast<std::size_t>(buckets) * 14 + 256);
    // v2 added `transients` + `sensitivity`, v3 added `bpm`, v4 added the three band envelopes. The Node
    // side REQUIRES the current version (waveformCache.ts): an older sidecar has a matching fingerprint and
    // would otherwise read as fresh forever, missing whatever the bump added.
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
    // The three bands, in the same bucket space as `peak` — so a consumer indexes all four the same way.
    // Their names are what they are for: a waveform coloured by what is IN it, the way a DJ player draws one.
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
    // 0 means "no tempo found" — silence, one sustained note, free time. Never a guess: this is the number
    // every later grid would trust.
    out += "],\"bpm\":";
    char bpmBuf[32];
    std::snprintf(bpmBuf, sizeof(bpmBuf), "%.2f", bpm);
    out += bpmBuf;
    out += ",\"sensitivity\":";
    char sens[32];
    std::snprintf(sens, sizeof(sens), "%.4f", transientSensitivity);
    out += sens;
    // Onsets in FILE seconds, not bucket indices: a consumer maps them onto whatever region it draws, and
    // seconds survive a change of bucket density that indices would not.
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
