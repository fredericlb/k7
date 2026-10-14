// RecordSource.cpp — see RecordSource.h. The cache is a folder of WAVs named by what they were decoded from,
// written under a temporary name and moved into place, and trimmed oldest-first past a size (docs/turntable.md).

#include "RecordSource.h"

#include <algorithm>
#include <cstring>
#include <vector>

namespace studio {

namespace {

// Past this the cache drops its least recently used records: a copy is only a head start, and the source is still there.
constexpr juce::int64 kCacheBytes = juce::int64(4) * 1024 * 1024 * 1024;

// Where a WAV's sample data starts and how many bytes it holds, by walking its RIFF chunks.
bool wavLayout(const juce::File& file, juce::int64& offset, juce::int64& bytes)
{
    juce::FileInputStream in{file};
    if (!in.openedOk()) return false;
    char tag[4];
    if (in.read(tag, 4) != 4 || std::memcmp(tag, "RIFF", 4) != 0) return false;
    in.readInt();
    if (in.read(tag, 4) != 4 || std::memcmp(tag, "WAVE", 4) != 0) return false;
    while (!in.isExhausted()) {
        if (in.read(tag, 4) != 4) return false;
        const auto size = static_cast<juce::int64>(static_cast<juce::uint32>(in.readInt()));
        if (std::memcmp(tag, "data", 4) == 0) {
            offset = in.getPosition();
            bytes = juce::jmin(size, in.getTotalLength() - offset);
            return true;
        }
        // Chunks are word-aligned: an odd size carries a pad byte.
        in.setPosition(in.getPosition() + size + (size & 1));
    }
    return false;
}

juce::File cacheDir()
{
    return juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("k7-record-cache");
}

// Oldest first until the folder fits, never the copy just made or used.
void trimCache(const juce::File& dir, const juce::File& keep)
{
    auto files = dir.findChildFiles(juce::File::findFiles, false, "*.wav");
    juce::int64 total = 0;
    for (const auto& f : files) total += f.getSize();
    std::sort(files.begin(), files.end(), [](const juce::File& a, const juce::File& b) {
        return a.getLastModificationTime() < b.getLastModificationTime();
    });
    for (const auto& f : files) {
        if (total <= kCacheBytes) break;
        if (f == keep) continue;
        total -= f.getSize();
        f.deleteFile();
    }
}

// The file decoded ONCE into a WAV the deck can map — integer at the source's depth, float if the source is float, two channels at most.
std::optional<juce::File> cachedCopy(const juce::File& src)
{
    const auto key = juce::String::toHexString((src.getFullPathName() + "|" + juce::String(src.getSize()) + "|" +
                                                juce::String(src.getLastModificationTime().toMilliseconds()))
                                                   .hashCode64());
    const auto dir = cacheDir();
    if (!dir.createDirectory()) return std::nullopt;
    const auto target = dir.getChildFile(key + ".wav");
    if (target.existsAsFile()) {
        target.setLastModificationTime(juce::Time::getCurrentTime());
        return target;
    }

    juce::AudioFormatManager afm;
    afm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(src)};
    juce::String why;
    if (reader == nullptr || reader->lengthInSamples <= 0 || !plausibleRecord(*reader, why)) return std::nullopt;
    const int channels = static_cast<int>(juce::jmin(2u, reader->numChannels));
    const int bits = reader->usesFloatingPointData ? 32 : (reader->bitsPerSample > 16 ? 24 : 16);

    // Written under a name of its own and MOVED into place, so two decks loading one file never map half of it.
    const auto part = dir.getNonexistentChildFile(key, ".part", false);
    {
        auto out = part.createOutputStream();
        if (out == nullptr) return std::nullopt;
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::AudioFormatWriter> writer{
            wav.createWriterFor(out.get(), reader->sampleRate, static_cast<unsigned>(channels), bits, {}, 0)};
        if (writer == nullptr) {
            out.reset();
            part.deleteFile();
            return std::nullopt;
        }
        out.release();   // the writer owns the stream now
        constexpr int chunk = 1 << 16;
        juce::AudioBuffer<float> buf{channels, chunk};
        for (juce::int64 at = 0; at < reader->lengthInSamples; at += chunk) {
            // std::min, not juce::jmin<int64>: on Android arm64 that also tries juce_dsp's SIMD overload, a hard error.
            const auto n = static_cast<int>(std::min<juce::int64>(chunk, reader->lengthInSamples - at));
            reader->read(&buf, 0, n, at, true, channels > 1);
            if (!writer->writeFromAudioSampleBuffer(buf, 0, n)) {
                writer.reset();
                part.deleteFile();
                return std::nullopt;
            }
        }
    }
    // Another load may have got there first; its copy is as good as this one.
    if (!part.moveFileTo(target)) part.deleteFile();
    if (!target.existsAsFile()) return std::nullopt;
    trimCache(dir, target);
    return target;
}

}  // namespace

bool plausibleRecord(const juce::AudioFormatReader& reader, juce::String& why)
{
    // A long DJ mix is three hours; twice that is a corrupt header, which would otherwise write a WAV until the disk is full.
    constexpr double kMaxSeconds = 6 * 3600.0;
    const double rate = reader.sampleRate;
    if (reader.numChannels < 1 || reader.numChannels > 32) why = "its header claims " + juce::String(reader.numChannels) + " channels";
    else if (!(rate > 0.0) || rate > 768000.0) why = "its header claims a rate of " + juce::String(rate) + " Hz";
    else if ((double)reader.lengthInSamples > kMaxSeconds * rate) why = "its header claims more than six hours";
    else return true;
    return false;
}

std::optional<MappedRecord> mapWavRecord(const juce::File& file)
{
    if (juce::ByteOrder::isBigEndian() || !file.hasFileExtension("wav;wave")) return std::nullopt;
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::AudioFormatReader> reader{wav.createReaderFor(file.createInputStream().release(), true)};
    if (reader == nullptr || reader->numChannels < 1 || reader->numChannels > 2) return std::nullopt;
    const bool isFloat = reader->usesFloatingPointData;
    if (isFloat ? reader->bitsPerSample != 32 : (reader->bitsPerSample != 16 && reader->bitsPerSample != 24))
        return std::nullopt;

    juce::int64 dataAt = 0, dataBytes = 0;
    if (!wavLayout(file, dataAt, dataBytes)) return std::nullopt;
    MappedRecord r;
    r.map = std::make_unique<juce::MemoryMappedFile>(file, juce::MemoryMappedFile::readOnly, false);
    if (r.map->getData() == nullptr || static_cast<juce::int64>(r.map->getSize()) < dataAt + dataBytes)
        return std::nullopt;
    r.width = static_cast<int>(reader->bitsPerSample / 8);
    r.isFloat = isFloat;
    r.channels = static_cast<int>(reader->numChannels);
    r.sampleRate = reader->sampleRate;
    r.pcm = static_cast<const unsigned char*>(r.map->getData()) + dataAt;
    r.frames = static_cast<int>(std::min<juce::int64>(
        {reader->lengthInSamples, dataBytes / (r.width * r.channels), std::numeric_limits<int>::max()}));
    if (r.frames <= 0) return std::nullopt;
    // Every page touched HERE, off the audio thread, so a needle dropped anywhere finds it resident.
    volatile unsigned char sink = 0;
    for (juce::int64 b = 0; b < static_cast<juce::int64>(r.frames) * r.width * r.channels; b += 4096)
        sink = sink ^ r.pcm[b];
    return r;
}

std::optional<MappedRecord> openRecord(const juce::File& file, juce::String& how)
{
    if (auto direct = mapWavRecord(file)) {
        how = "mapped";
        return direct;
    }
    if (const auto copy = cachedCopy(file))
        if (auto cached = mapWavRecord(*copy)) {
            how = "mapped from the record cache";
            return cached;
        }
    return std::nullopt;
}

}  // namespace studio
