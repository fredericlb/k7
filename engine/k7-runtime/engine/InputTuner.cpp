#include "InputTuner.h"

#include <algorithm>
#include <cmath>

namespace studio {

namespace {
// The band searched, in Hz: a 5-string bass's B (31 Hz) to a guitar's 12th-fret high E (659 Hz), past which a fundamental is weaker than its harmonics.
constexpr double kMinHz = 30.0;
constexpr double kMaxHz = 700.0;
// YIN's threshold, the paper's 0.15: lower reports fewer notes, higher starts finding periods in noise.
constexpr float kThreshold = 0.15f;
// The silence gate, meaning "nobody is playing" rather than true zero — the measured false note it answers is in docs/inputTuner.md.
constexpr float kMinRms = 0.01f;   // ≈ -40 dBFS
}  // namespace

PitchEstimate detectPitch(const float* samples, int count, double sampleRate) {
    if (samples == nullptr || count < 64 || sampleRate <= 0.0) return {};

    // Silence gate first: everything below is wasted work on a window with nothing in it.
    double sumSq = 0.0;
    for (int i = 0; i < count; ++i) sumSq += static_cast<double>(samples[i]) * samples[i];
    if (std::sqrt(sumSq / count) < kMinRms) return {};

    const int maxLag = std::min(count / 2, static_cast<int>(sampleRate / kMinHz));
    const int minLag = std::max(2, static_cast<int>(sampleRate / kMaxHz));
    if (maxLag <= minLag) return {};

    // d(tau): the squared difference between the window and itself shifted by tau.
    std::vector<float> d(static_cast<size_t>(maxLag) + 1, 0.0f);
    const int n = count - maxLag;
    for (int tau = minLag; tau <= maxLag; ++tau) {
        double sum = 0.0;
        for (int i = 0; i < n; ++i) {
            const double diff = static_cast<double>(samples[i]) - samples[i + tau];
            sum += diff * diff;
        }
        d[static_cast<size_t>(tau)] = static_cast<float>(sum);
    }

    // The cumulative mean normalisation, which is what makes it YIN: d' is ~1 at every lag that merely correlates and dips only at the true period.
    std::vector<float> dn(static_cast<size_t>(maxLag) + 1, 1.0f);
    double running = 0.0;
    for (int tau = minLag; tau <= maxLag; ++tau) {
        running += d[static_cast<size_t>(tau)];
        dn[static_cast<size_t>(tau)] =
            running > 0.0 ? static_cast<float>(d[static_cast<size_t>(tau)] * (tau - minLag + 1) / running) : 1.0f;
    }

    // The FIRST dip below the threshold and then its local minimum, not the deepest — the deepest is often a multiple of the period.
    int best = -1;
    for (int tau = minLag; tau <= maxLag; ++tau) {
        if (dn[static_cast<size_t>(tau)] >= kThreshold) continue;
        while (tau + 1 <= maxLag && dn[static_cast<size_t>(tau + 1)] < dn[static_cast<size_t>(tau)]) ++tau;
        best = tau;
        break;
    }
    if (best < 0) return {};

    // Parabolic interpolation around the minimum: whole samples at 12 kHz is ~40 cents at the top of the range, useless for the one job a tuner has.
    double period = best;
    if (best > minLag && best < maxLag) {
        const double a = dn[static_cast<size_t>(best) - 1];
        const double b = dn[static_cast<size_t>(best)];
        const double c = dn[static_cast<size_t>(best) + 1];
        const double denom = 2.0 * (2.0 * b - a - c);
        if (std::abs(denom) > 1e-12) period += (c - a) / denom;
    }
    if (period <= 0.0) return {};

    return {static_cast<float>(sampleRate / period),
            std::clamp(1.0f - dn[static_cast<size_t>(best)], 0.0f, 1.0f)};
}

void InputTuner::watch(const std::vector<int>& channels) {
    std::lock_guard<std::mutex> lk(mx_);
    // Rebuilt rather than merged, so a dropped channel stops costing anything while a surviving one keeps the history it needs to settle.
    std::map<int, Ring> next;
    for (const int ch : channels) {
        // A channel asked for TWICE must be taken once, or the second take carries across a moved-from Ring — docs/inputTuner.md.
        if (ch <= 0 || next.count(ch) != 0) continue;
        // Bounded like the meters: the numbers come off the wire, and each one costs a ring.
        if (ch > kMaxChannels) continue;
        auto it = rings_.find(ch);
        next[ch] = it != rings_.end() ? std::move(it->second) : Ring{};
    }
    rings_ = std::move(next);
    watching_.store(!rings_.empty(), std::memory_order_relaxed);
}

float InputTuner::getAndClearPeak(int channel) {
    const int index = channel - 1;   // 1-based on the wire, 0-based in the device
    if (index < 0 || index >= kMaxChannels) return 0.0f;
    return peak_[static_cast<size_t>(index)].exchange(0.0f, std::memory_order_relaxed);
}

PitchEstimate InputTuner::pitchOf(int channel) {
    std::vector<float> window;
    int start = 0;
    {
        std::lock_guard<std::mutex> lk(mx_);
        auto it = rings_.find(channel);
        if (it == rings_.end()) return {};
        // Not until it has been round once: a half-filled ring splices real audio onto startup zeros, and that step reads as a period.
        if (it->second.primed < static_cast<int>(it->second.data.size())) return {};
        window = it->second.data;   // copied, so the estimate runs without holding the audio thread's lock
        start = it->second.write;
    }
    // Unwrap the ring into chronological order: the difference function reads it as one continuous signal, and a wrap looks like a period.
    std::vector<float> linear(window.size());
    for (size_t i = 0; i < window.size(); ++i)
        linear[i] = window[(static_cast<size_t>(start) + i) % window.size()];
    const auto est = detectPitch(linear.data(), static_cast<int>(linear.size()),
                                 tapRate_.load(std::memory_order_relaxed));

    // Confirm against the previous poll: a lucky window is as loud and as periodic as a note, but only the note is still there 100 ms later.
    std::lock_guard<std::mutex> lk(mx_);
    auto it = rings_.find(channel);
    if (it == rings_.end()) return {};
    const float prev = it->second.lastRaw;
    it->second.lastRaw = est.hz;
    if (est.hz <= 0.0f || prev <= 0.0f) return {};
    return std::abs(est.hz / prev - 1.0f) <= kAgreeRatio ? est : PitchEstimate{};
}

void InputTuner::audioDeviceIOCallbackWithContext(const float* const* input, int numInput,
                                                  float* const* output, int numOutput,
                                                  int numSamples,
                                                  const juce::AudioIODeviceCallbackContext&) {
    // FIRST and unconditionally, before any early return: JUCE ADDS a non-first callback's uninitialised output buffer into the real one.
    for (int ch = 0; ch < numOutput; ++ch)
        if (output[ch] != nullptr) juce::FloatVectorOperations::clear(output[ch], numSamples);

    // The meters, BEFORE the watching_ gate, since reading a level is how you decide what to watch — one pass per channel, no lock, no allocation.
    inputChannels_.store(numInput, std::memory_order_relaxed);
    const int metered = std::min(numInput, kMaxChannels);
    for (int ch = 0; ch < metered; ++ch) {
        if (input[ch] == nullptr) continue;
        juce::Range<float> r = juce::FloatVectorOperations::findMinAndMax(input[ch], numSamples);
        const float mag = std::max(std::abs(r.getStart()), std::abs(r.getEnd()));
        // Hold the highest until the reader clears it, or a meter polled at 8 Hz misses the very transient it is being watched for.
        float prev = peak_[static_cast<size_t>(ch)].load(std::memory_order_relaxed);
        while (mag > prev
               && !peak_[static_cast<size_t>(ch)].compare_exchange_weak(prev, mag,
                                                                        std::memory_order_relaxed)) {
        }
    }

    if (!watching_.load(std::memory_order_relaxed)) return;

    const int step = std::max(1, decimate_.load(std::memory_order_relaxed));
    // try_lock, never lock: this is the audio thread, and a tuner missing one buffer in a hundred reads identically to one missing none.
    std::unique_lock<std::mutex> lk(mx_, std::try_to_lock);
    if (!lk.owns_lock()) return;

    for (auto& [channel, ring] : rings_) {
        const int index = channel - 1;   // 1-based in the doc, 0-based in the device
        if (index < 0 || index >= numInput || input[index] == nullptr) continue;
        if (ring.data.empty()) continue;   // never divide by its size below; watch() must not build one, but this is the audio thread
        const float* src = input[index];
        for (int i = 0; i < numSamples; ++i) {
            // Plain decimation, no anti-alias filter: an aliased partial lands somewhere random and fails the dip test, while the fundamental is far below the new Nyquist.
            if (++ring.decimateCount < step) continue;
            ring.decimateCount = 0;
            ring.data[static_cast<size_t>(ring.write)] = src[i];
            ring.write = (ring.write + 1) % static_cast<int>(ring.data.size());
            if (ring.primed < static_cast<int>(ring.data.size())) ++ring.primed;
        }
    }
}

void InputTuner::audioDeviceAboutToStart(juce::AudioIODevice* device) {
    const double rate = device != nullptr ? device->getCurrentSampleRate() : 48000.0;
    const int step = std::max(1, static_cast<int>(std::lround(rate / 12000.0)));
    decimate_.store(step, std::memory_order_relaxed);
    tapRate_.store(rate / step, std::memory_order_relaxed);
    // The rings hold samples at the OLD rate; keeping them would report a note transposed by the rate change.
    std::lock_guard<std::mutex> lk(mx_);
    for (auto& [channel, ring] : rings_) {
        juce::ignoreUnused(channel);
        std::fill(ring.data.begin(), ring.data.end(), 0.0f);
        ring.write = 0;
        ring.decimateCount = 0;
        ring.primed = 0;   // zeros again, so it must fill again before it is believed
    }
}

void InputTuner::audioDeviceStopped() {}

}  // namespace studio
