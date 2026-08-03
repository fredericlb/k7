// NormalizeClips.cpp — `--normalize <targetPeak> <in> <out>…`: peak-normalize a set of clips with a SINGLE
// shared gain, so the loudest hits the target and the rest keep their relative levels. Prints a JSON manifest.
// The brain decides WHICH clips; the engine owns decoding. See docs/cliModes.md.

#include "EngineHost.h"

#include "EngineTypes.h"  // Tracktion/JUCE + the te/tt/fs aliases

#include <algorithm>
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace studio {

int normalizeClips(double targetPeak,
                   const std::vector<std::pair<std::string, std::string>>& pairs) {
    if (pairs.empty()) {
        std::cerr << "[normalize] no input files\n";
        return 2;
    }

    juce::AudioFormatManager afm;
    afm.registerBasicFormats();  // wav/aiff/flac/ogg (+ platform mp3/m4a where built)

    // Phase 1: decode every input into memory and find the loudest peak across ALL of them (clips are short
    // one-shots, so a whole-file buffer each is fine).
    struct Loaded {
        juce::AudioBuffer<float> buf;
        double sampleRate = 48000.0;
        int bits = 24;
    };
    std::vector<Loaded> loaded;
    loaded.reserve(pairs.size());
    float maxPeak = 0.0f;

    for (const auto& [in, out] : pairs) {
        (void) out;
        const juce::File f{juce::String(in)};
        std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(f)};
        if (!reader) {
            std::cerr << "[normalize] cannot decode: " << in << "\n";
            return 2;
        }
        const int channels = std::max(1, static_cast<int>(reader->numChannels));
        const int frames = static_cast<int>(reader->lengthInSamples);
        Loaded L;
        L.buf.setSize(channels, std::max(1, frames));
        L.buf.clear();
        if (frames > 0) reader->read(&L.buf, 0, frames, 0, true, true);
        L.sampleRate = reader->sampleRate > 0 ? reader->sampleRate : 48000.0;
        L.bits = reader->bitsPerSample > 0 ? static_cast<int>(reader->bitsPerSample) : 24;
        maxPeak = std::max(maxPeak, L.buf.getMagnitude(0, L.buf.getNumSamples()));
        loaded.push_back(std::move(L));
    }

    // One shared gain: bring the loudest peak to the target. Silence (peak 0) stays as-is.
    const double gain = maxPeak > 0.0f ? targetPeak / static_cast<double>(maxPeak) : 1.0;

    // Phase 2: scale + write each output, preserving the source's format.
    juce::WavAudioFormat wav;
    for (std::size_t i = 0; i < pairs.size(); ++i) {
        Loaded& L = loaded[i];
        L.buf.applyGain(static_cast<float>(gain));

        const juce::File outF{juce::String(pairs[i].second)};
        outF.deleteFile();  // overwrite a stale _norm from a previous run
        auto os = std::make_unique<juce::FileOutputStream>(outF);
        if (os->failedToOpen()) {
            std::cerr << "[normalize] cannot write: " << pairs[i].second << "\n";
            return 2;
        }
        // createWriterFor takes ownership of the stream ON SUCCESS; on failure it does not, so the unique_ptr frees it.
        const juce::StringPairArray meta;
        std::unique_ptr<juce::AudioFormatWriter> writer{wav.createWriterFor(
            os.get(), L.sampleRate,
            static_cast<unsigned int>(L.buf.getNumChannels()), L.bits, meta, 0)};
        if (!writer) {
            std::cerr << "[normalize] cannot create writer: " << pairs[i].second << "\n";
            return 2;
        }
        os.release();  // the writer owns the stream now
        const bool ok =
            writer->writeFromAudioSampleBuffer(L.buf, 0, L.buf.getNumSamples());
        writer.reset();  // flush + close (and delete the owned stream)
        if (!ok) {
            std::cerr << "[normalize] write failed: " << pairs[i].second << "\n";
            return 2;
        }
    }

    std::cout << "{\"maxPeak\":" << maxPeak << ",\"gain\":" << gain
              << ",\"count\":" << pairs.size() << "}\n";
    return 0;
}

}  // namespace studio
