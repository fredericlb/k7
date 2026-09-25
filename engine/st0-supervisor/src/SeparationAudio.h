// SeparationAudio.h — the arithmetic a stem separation needs, with no model and no disk in it: how a
// long file is cut into the fixed windows the model accepts, how the overlapping results are folded
// back into one signal, and what a 24-bit WAV looks like. The port of stem-separation's
// separateAudio.ts, its tests replayed; the rationale is its docs/stemSplit.md.

#pragma once

#include <array>
#include <string>
#include <vector>

namespace st0::separation {

/** HT-Demucs is trained at 44.1 kHz stereo, and the exported graph has it baked in. */
constexpr int kSampleRate = 44100;
constexpr int kChannels = 2;
/** The model's input is a FIXED `[1, 2, 343980]` — 7.8 s, not a hint. */
constexpr size_t kSegment = 343980;
/** A quarter of each window repeats the one before — Demucs' own default, and what hides the seam. */
constexpr size_t kHop = 257985;

/** The four sources the model returns, IN THE ORDER it returns them. */
inline const std::array<std::string, 4> kStems = {"drums", "bass", "other", "vocals"};
/** Every stem but the voice, summed. */
inline const std::string kInstrumental = "instrumental";

using Channels = std::vector<std::vector<float>>;

/** Where each window starts, the last pulled BACK so the tail is real audio. */
std::vector<size_t> windowStarts(size_t length);

/** A triangular weight over one window, its ends nudged off zero. */
std::vector<float> triangle(size_t n = kSegment);

/** The accumulator that folds overlapping windows into one signal, per stem and channel. */
class OverlapAdd {
public:
    explicit OverlapAdd(size_t length, size_t stems = kStems.size());
    /** Fold one window's output in; `at` is where the window starts in the whole signal. */
    void add(size_t at, size_t stem, size_t channel, const float* samples, size_t n);
    /** Counted once per window, after its stems are all added: the weight is per POSITION. */
    void countWindow(size_t at);
    /** One stem's channels, divided through. */
    Channels finish(size_t stem) const;

private:
    size_t length_;
    std::vector<Channels> acc_;
    std::vector<float> weight_;
    std::vector<float> win_;
};

/** Interleaved f32, as ffmpeg writes it → one buffer per channel. */
Channels deinterleave(const std::vector<float>& pcm, int channels = kChannels);

/** Interleaved again, for ffmpeg to resample. */
std::vector<float> interleave(const Channels& chans);

/** The loudest sample across every channel — what says a stem was CLAMPED. */
float peakOf(const Channels& chans);

/** A 24-bit PCM WAV, header and all: integer because the consumer is a deck. */
std::string wavPcm24(const Channels& chans, int sampleRate = kSampleRate);

/** One output's signal: a stem as the model gives it, or every stem but the voice summed. */
Channels outputChannels(const OverlapAdd& oa, const std::string& name);

}  // namespace st0::separation
