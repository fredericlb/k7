// QuickMasterPlugin.h — a master bus in one module: a three-band compressor, a stereo spreader
// and a lookahead limiter, in that order and in that order only.
//
// Ten knobs, no routing, and neutral at its defaults — the three amounts sit at zero and the
// width at 100%. Why the bands split where they do, what the makeup law is and what the ceiling
// actually guarantees are in docs/quickMaster.md.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include "Biquad.h"   // IIRFilter's arithmetic without its lock

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace studio {

class QuickMasterPlugin : public tracktion::engine::Plugin {
public:
    explicit QuickMasterPlugin(tracktion::engine::PluginCreationInfo info);
    ~QuickMasterPlugin() override;

    static const char* getPluginName() { return "Quick Master"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Quick Master"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Master"; }
    juce::String getSelectableDescription() override { return "Quick Master"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    // The limiter's delay line still holds audio after the input stops, so the graph must not cut it.
    bool noTail() override { return false; }
    double getTailLength() const override { return lookaheadMs / 1000.0; }
    /** DECLARED, not absorbed: on a master bus an uncompensated latency lands a parallel send early. */
    double getLatencySeconds() override { return lookaheadMs / 1000.0; }

    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** How far ahead the limiter's detector sees, in ms — and the latency this plugin reports IS it. */
    static constexpr float lookaheadMs = 2.0f;

    /** The three detectors' times, in ms — slow on the bass, quick on the air (docs/quickMaster.md). */
    static constexpr std::array<float, 3> bandAttackMs{30.0f, 15.0f, 5.0f};
    static constexpr std::array<float, 3> bandReleaseMs{250.0f, 150.0f, 80.0f};

    /** What an `Amount` of 0 and of 100 mean, in the units a compressor is read in. */
    static constexpr float compThresholdTopDb = -8.0f;
    static constexpr float compThresholdDeepDb = -24.0f;
    static constexpr float compRatioMax = 4.0f;
    /** HALF of what the threshold gave away is handed back: a macro compensating in full only gets louder. */
    static constexpr float compMakeupShare = 0.5f;

    /** Below this the bass-mono corner is OFF rather than very low — a high-pass at 0 Hz has no coefficients. */
    static constexpr float bassMonoOffHz = 20.0f;

private:
    // A stop or a panic on the message thread only raises this; the next block clears the state it owns (docs/panic.md).
    std::atomic<bool> resetPending_{false};
    void clearState();
    // One biquad per channel — a stage, since every corner here is Linkwitz-Riley and therefore two of them.
    struct Stage {
        studio::Biquad ch[2];
        void reset() { for (auto& f : ch) f.reset(); }
        void set(const juce::IIRCoefficients& c) { for (auto& f : ch) f.setCoefficients(c); }
    };

    // LR4 a side, plus the allpass that keeps the low band in step so the three sum FLAT (docs/quickMaster.md).
    Stage lowLp_[2], restHp_[2], midLp_[2], highHp_[2], lowAp_;
    // The bass-mono corner, on the SIDE only — which is mono, so the LR4 pair is filters, not stages.
    studio::Biquad sideHp_[2];

    double rate_ = 44100.0;
    int maxBlock_ = 512;
    // What the coefficients were last computed from, so a knob that has not moved costs nothing.
    float lastLowHz_ = -1.0f, lastHighHz_ = -1.0f, lastBassMonoHz_ = -1.0f;

    // Per-band detectors and the limiter's gain, STEREO-LINKED: moving the channels apart moves the image.
    std::array<float, 3> env_{0.0f, 0.0f, 0.0f};
    float limGain_ = 1.0f;

    // The bands, split out of the input and summed back. Allocated at initialise(), never here.
    juce::AudioBuffer<float> bands_[3];
    // The limiter's lookahead line, one per channel, and its write cursor.
    std::vector<float> delay_[2];
    int delayWrite_ = 0;

    tracktion::engine::AutomatableParameter::Ptr lowFreq_, highFreq_, lowComp_, midComp_,
        highComp_, width_, bassMono_, drive_, ceiling_, release_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;

    void updateCoefficients(float lowHz, float highHz, float bassMonoHz);
    void splitBands(const juce::AudioBuffer<float>& src, int start, int numChans, int n);
    void compressBands(int numChans, int n);
    void spread(juce::AudioBuffer<float>& dst, int start, int numChans, int n, float width,
                bool bassMono);
    void limit(juce::AudioBuffer<float>& dst, int start, int numChans, int n, float driveLin,
               float ceilLin, float relCoeff);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(QuickMasterPlugin)
};

}  // namespace studio
