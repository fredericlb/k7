#pragma once

// Pitch and level on the interface's RAW inputs, for the I/O panel: its own audio callback and one ring per watched channel, never Tracktion's routing — docs/inputTuner.md.

#include "EngineTypes.h"

#include <array>
#include <atomic>
#include <map>
#include <mutex>
#include <vector>

namespace studio {

// Frequency estimate for one channel; `hz` is 0 when nothing confident was found, which the UI shows as "no note" rather than as a wrong one.
struct PitchEstimate {
    float hz = 0.0f;
    float clarity = 0.0f;   // 0..1, how periodic the window was; the UI can fade an uncertain reading
};

// The fundamental of `samples`, or 0 when the window isn't convincingly periodic — a free function so the maths is testable without a device (docs/inputTuner.md).
PitchEstimate detectPitch(const float* samples, int count, double sampleRate);

// A tap on the open interface's inputs, registered as a SECOND juce::AudioDeviceManager callback — the trap that comes with that is in docs/inputTuner.md.
class InputTuner : public juce::AudioIODeviceCallback {
public:
    // Start filling rings for these 1-based channels and drop the rest; called from the message thread, so the set is mutex-guarded against the audio one.
    void watch(const std::vector<int>& channels);

    // The current estimate for a 1-based channel — {} when it isn't watched, or has no confident pitch.
    PitchEstimate pitchOf(int channel);

    // Is anything being watched? The engine skips the whole path when not, so an unopened panel costs nothing.
    bool active() const { return watching_.load(std::memory_order_relaxed); }

    // Peak level on a 1-based channel since the last read, as a linear magnitude, and reading CLEARS it — here rather than on a LevelMeasurer per docs/inputTuner.md.
    float getAndClearPeak(int channel);

    // How many input channels the open device delivers, as the audio callback last saw it, so a channel beyond it reads as "not measured" rather than as silence.
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
        // Samples written since this channel started being watched, gating the ring until it has been round once — the measured false note is in docs/inputTuner.md.
        int primed = 0;
        // The previous estimate, reported or not: a reading is believed only once two polls in a row agree, which noise never manages.
        float lastRaw = 0.0f;
    };

    // How close two consecutive estimates must be to agree: 3%, about half a semitone — wide enough for a turning peg, narrow enough that two flukes never match.
    static constexpr float kAgreeRatio = 0.03f;

    // Peak per 0-based channel since the reader last cleared it: plain atomics in a fixed array, no history to guard and no allocation on the audio thread.
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
