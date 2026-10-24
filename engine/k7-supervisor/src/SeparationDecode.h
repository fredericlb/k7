// SeparationDecode.h — a mix decoded into the shape the model wants, and a stem taken back to the
// record's rate, through the media library's own Rust decoder (rust/, include/k7_audio.h): no ffmpeg.
// Built without it (a platform with no stem separation), both throw a sentence saying so.

#pragma once

#include "SeparationAudio.h"

#include <string>

namespace k7::separation {

struct Decoded {
    /** kChannels channels at kSampleRate, whatever the file holds. */
    Channels channels;
    /** The file's own rate, which the stems are written back at. */
    int sourceRate = 0;
};

/** Decodes `path` (UTF-8), failing HARD: there is no lesser result to fall back to. */
Decoded decodeForModel(const std::string& path);

/** `chans` from `from` Hz to `to` Hz. */
Channels resample(const Channels& chans, int from, int to);

}  // namespace k7::separation
