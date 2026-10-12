// RecordSource.h — where a platter's record is READ from: a WAV mapped where it lies, or anything else decoded
// ONCE into a WAV in the record cache and mapped from there (docs/turntable.md).
// The one thing a reader would get wrong: nothing here holds a record in private memory — the pages are the file's.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <memory>
#include <optional>

namespace studio {

struct MappedRecord {
    std::unique_ptr<juce::MemoryMappedFile> map;
    const unsigned char* pcm = nullptr;   // the first sample, interleaved
    int width = 2;                        // bytes per sample: 2 or 3 (integer), 4 (float)
    bool isFloat = false;
    int channels = 2;                     // 1 or 2
    int frames = 0;
    double sampleRate = 0.0;
};

/** A little-endian WAV of one or two channels, 16/24-bit integer or 32-bit float, mapped and its pages touched; empty for anything else. */
std::optional<MappedRecord> mapWavRecord(const juce::File& file);

/** The record as something mappable: the file itself, or its copy in the record cache, decoded on first use. `how` says which. */
std::optional<MappedRecord> openRecord(const juce::File& file, juce::String& how);

/** Whether a header describes a record rather than a corrupt file; `why` says which bound it broke. Every decode sizes itself from it. */
bool plausibleRecord(const juce::AudioFormatReader& reader, juce::String& why);

}  // namespace studio
