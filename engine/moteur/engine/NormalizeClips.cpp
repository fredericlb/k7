// NormalizeClips.cpp — `--normalize <targetPeak> [<in> <out> <fromSec> <toSec>]…`: peak-normalize a set of
// clips with a SINGLE shared gain, each measured and gained INSIDE its own window (toSec < 0 == the file's
// end). Prints a JSON manifest. The brain decides WHICH clips and windows; the engine owns decoding.

#include "EngineHost.h"

#include "EngineTypes.h"  // Tracktion/JUCE + the te/tt/fs aliases

#include <algorithm>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace studio {

int normalizeClips(double targetPeak, const std::vector<NormalizeItem>& items) {
    if (items.empty()) {
        std::cerr << "[normalize] no input files\n";
        return 2;
    }

    juce::AudioFormatManager afm;
    afm.registerBasicFormats();  // wav/aiff/flac/ogg (+ platform mp3/m4a where built)

    // Phase 1: decode every input into memory and find the loudest peak across ALL of them, each read
    // inside its own window (clips are short one-shots, so a whole-file buffer each is fine).
    struct Loaded {
        juce::AudioBuffer<float> buf;
        double sampleRate = 48000.0;
        int bits = 24;
        int winStart = 0;  // the window, in frames of THIS file
        int winLen = 0;
    };
    std::vector<Loaded> loaded;
    loaded.reserve(items.size());
    float maxPeak = 0.0f;

    for (const auto& it : items) {
        const juce::File f{juce::String(it.in)};
        std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(f)};
        if (!reader) {
            std::cerr << "[normalize] cannot decode: " << it.in << "\n";
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

        // The window in frames, clamped to the file. A window the file outgrew, or one that does not
        // run forwards, falls back to the whole file — the brain's numbers are seconds a person typed.
        const int total = L.buf.getNumSamples();
        int w0 = static_cast<int>(std::llround(std::max(0.0, it.fromSec) * L.sampleRate));
        int w1 = it.toSec < 0.0 ? total
                                : static_cast<int>(std::llround(it.toSec * L.sampleRate));
        w0 = std::clamp(w0, 0, total);
        w1 = std::clamp(w1, 0, total);
        if (w1 <= w0) { w0 = 0; w1 = total; }
        L.winStart = w0;
        L.winLen = w1 - w0;

        maxPeak = std::max(maxPeak, L.buf.getMagnitude(L.winStart, L.winLen));
        loaded.push_back(std::move(L));
    }

    // One shared gain: bring the loudest windowed peak to the target. Silence (peak 0) stays as-is.
    const double gain = maxPeak > 0.0f ? targetPeak / static_cast<double>(maxPeak) : 1.0;

    // Phase 2: apply the gain inside each window, write each output whole, preserving the source's format.
    juce::WavAudioFormat wav;
    for (std::size_t i = 0; i < items.size(); ++i) {
        Loaded& L = loaded[i];
        L.buf.applyGain(L.winStart, L.winLen, static_cast<float>(gain));

        const juce::File outF{juce::String(items[i].out)};
        outF.deleteFile();  // overwrite a stale _norm from a previous run
        auto os = std::make_unique<juce::FileOutputStream>(outF);
        if (os->failedToOpen()) {
            std::cerr << "[normalize] cannot write: " << items[i].out << "\n";
            return 2;
        }
        // createWriterFor takes ownership of the stream ON SUCCESS; on failure it does not, so the unique_ptr frees it.
        const juce::StringPairArray meta;
        std::unique_ptr<juce::AudioFormatWriter> writer{wav.createWriterFor(
            os.get(), L.sampleRate,
            static_cast<unsigned int>(L.buf.getNumChannels()), L.bits, meta, 0)};
        if (!writer) {
            std::cerr << "[normalize] cannot create writer: " << items[i].out << "\n";
            return 2;
        }
        os.release();  // the writer owns the stream now
        const bool ok =
            writer->writeFromAudioSampleBuffer(L.buf, 0, L.buf.getNumSamples());
        writer.reset();  // flush + close (and delete the owned stream)
        if (!ok) {
            std::cerr << "[normalize] write failed: " << items[i].out << "\n";
            return 2;
        }
    }

    std::cout << "{\"maxPeak\":" << maxPeak << ",\"gain\":" << gain
              << ",\"count\":" << items.size() << "}\n";
    return 0;
}

}  // namespace studio
