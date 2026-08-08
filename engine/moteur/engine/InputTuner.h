#pragma once

// Pitch on the interface's raw inputs, for the I/O panel's tuner.
//
// The level meters read Tracktion's LevelMeasurer, which reports dB and nothing else — a tuner needs SAMPLES.
// So this taps the device manager directly with its own audio callback, one ring buffer per watched channel,
// and estimates a fundamental on demand. Independent of Tracktion's input routing on purpose: you tune a guitar
// before there is a track to plug it into. Rationale: docs/inputTuner.md.

#include "EngineTypes.h"

#include <array>
#include <atomic>
#include <map>
#include <mutex>
#include <vector>

namespace studio {

// Frequency estimate for one channel. `hz` is 0 when nothing confident was found — silence, noise, or a sound
// with no clear fundamental — which the UI shows as "no note" rather than as a wrong one.
struct PitchEstimate {
    float hz = 0.0f;
    float clarity = 0.0f;   // 0..1, how periodic the window was; the UI can fade an uncertain reading
};

/**
 * The fundamental of `samples`, or 0 when the window isn't convincingly periodic.
 *
 * Free function so the estimator is testable without an audio device — the part worth testing is the maths.
 * Uses the cumulative-mean-normalised difference (YIN) rather than plain autocorrelation: on a guitar, plain
 * autocorrelation reports the octave below often enough to be useless, because a string's first harmonic can
 * correlate as strongly as its fundamental.
 */
PitchEstimate detectPitch(const float* samples, int count, double sampleRate);

/**
 * A tap on the open interface's inputs.
 *
 * Registered with juce::AudioDeviceManager as a SECOND callback. That has a trap worth naming: JUCE gives every
 * callback after the first an uninitialised temp buffer and ADDS it into the real output, so a callback that
 * ignores its output injects garbage into the mix. This one clears its output every block, which is correct
 * whichever position it ends up in.
 */
class InputTuner : public juce::AudioIODeviceCallback {
public:
    // Start filling ring buffers for these 1-based interface channels; anything not listed is dropped. Called
    // from the message thread when the panel asks, so the set is mutex-guarded against the audio thread.
    void watch(const std::vector<int>& channels);

    // The current estimate for a 1-based channel — {} when it isn't watched, or has no confident pitch.
    PitchEstimate pitchOf(int channel);

    // Is anything being watched? The engine skips the whole path when not, so an unopened panel costs nothing.
    bool active() const { return watching_.load(std::memory_order_relaxed); }

    /**
     * Peak level on a 1-based interface channel since the last read, as a linear magnitude. Reading CLEARS it.
     *
     * Here rather than on Tracktion's LevelMeasurer for the same reason the pitch rings are: measuring an input
     * must not require ROUTING it. Going through a WaveInputDevice means enabling it and giving it an instance on
     * a playback context, and each of those rebuilds the whole wave-device list and reallocates every Edit's
     * graph — which, asked for twenty inputs by a menu polling at 8 Hz, wedged the engine outright. This costs a
     * max over the block and knows nothing about any Edit. See docs/inputTuner.md.
     */
    float getAndClearPeak(int channel);

    // How many input channels the open device actually delivers — what the audio callback last saw, so a channel
    // beyond it reads as "not measured" rather than as silence. 0 before the first block.
    int inputChannels() const { return inputChannels_.load(std::memory_order_relaxed); }

    void audioDeviceIOCallbackWithContext(const float* const* input, int numInput,
                                          float* const* output, int numOutput,
                                          int numSamples,
                                          const juce::AudioIODeviceCallbackContext& ctx) override;
    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

private:
    // ~170 ms at 12 kHz after decimation — long enough to resolve a low B string, short enough to follow a tuning peg.
    static constexpr int kWindow = 2048;

    struct Ring {
        std::vector<float> data = std::vector<float>(kWindow, 0.0f);
        int write = 0;
        int decimateCount = 0;   // phase of the decimator feeding it
        // Samples written since this channel started being watched. Until the ring has been round once it still
        // holds startup zeros, and the join between those zeros and the first real audio is a step the difference
        // function reads as a period — measured: a confident 31.8 Hz on an input metering -100 dB.
        int primed = 0;
        // The previous estimate, reported or not. A reading is only believed once two polls in a row agree:
        // noise that happens to look periodic never picks the SAME frequency twice, while a held string does.
        float lastRaw = 0.0f;
    };

    // How close two consecutive estimates must be to count as agreeing — 3%, about half a semitone. Wide enough
    // that bending or a peg turning still reads, narrow enough that two unrelated flukes never match.
    static constexpr float kAgreeRatio = 0.03f;

    // Peak per 0-based device channel since the reader last cleared it. Plain atomics and no mutex: the meters
    // want one number per channel and no history, so unlike the pitch rings there is nothing to guard — and
    // unlike them this runs whether or not anything is being WATCHED, since a meter is what you read to find
    // out which input to watch. A fixed array so the audio thread never allocates.
    static constexpr int kMaxChannels = 64;
    std::array<std::atomic<float>, kMaxChannels> peak_{};
    std::atomic<int> inputChannels_{0};

    std::mutex mx_;                       // guards rings_ against the audio thread
    std::map<int, Ring> rings_;           // 1-based channel -> its decimated history
    std::atomic<bool> watching_{false};
    std::atomic<int> decimate_{4};        // native rate / ~12 kHz, recomputed when the device starts
    std::atomic<double> tapRate_{12000};  // the rate the rings actually hold
};

}  // namespace studio
