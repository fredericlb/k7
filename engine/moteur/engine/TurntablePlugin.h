// TurntablePlugin.h — a deck as a PLATTER rather than as a clip: it owns its audio and reads it at
// a position the desk drives, forwards, backwards or stopped.
//
// A clip on a timeline plays at the transport's rate and can only be re-placed, which is why a
// scratch measured as a stutter (packages/ui-turntables/docs/scratch.md). Here the position is the
// plugin's own, so nothing about it goes through the transport. See docs/turntable.md.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include "TurntableLoop.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace studio {

class TurntablePlugin : public tracktion::engine::Plugin {
public:
    explicit TurntablePlugin(tracktion::engine::PluginCreationInfo info);
    ~TurntablePlugin() override;

    static const char* getPluginName() { return "Turntable"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Turntable"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Deck"; }
    juce::String getSelectableDescription() override { return "Turntable"; }
    // A SOURCE: it is handed no audio and makes its own, which is what `role: instrument` means here.
    bool takesAudioInput() override { return false; }
    bool producesAudioWhenNoAudioInput() override { return true; }
    bool noTail() override { return true; }

    int getNumOutputChannelsGivenInputs(int) override { return 2; }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** Load the record, WHOLE and 16-bit — a scratch reads backwards and jumps, which no per-block
     *  disk reader follows. Why 16 bits is faster and not only smaller: docs/turntable.md. */
    bool loadRecord(const juce::File& file, juce::String& error);

    /** How long the loaded record is, in seconds — 0 with nothing on. Read by the host, not the audio thread. */
    double recordSeconds() const;

    /** Where the needle is, in seconds of the record. Published once a block for the state push. */
    double needleSeconds() const { return needle_.load(std::memory_order_relaxed); }

private:
    /** One interpolated frame of the record at `pos`. The caller holds the lock and has checked the bounds. */
    void frameAt(double pos, float& left, float& right) const;
    /** Read up to `n` frames at the record's OWN speed, for the stretcher. Returns what the record still had. */
    int readNatural(float* left, float* right, int n);
    /** Add `n` frames of the record played at `rate` with its pitch HELD — what KEY switches on. */
    void renderStretched(float* left, float* right, int start, int n, float rate, float gain);

    /** Where the needle is, in SAMPLES of the record — fractional, since a platter is not on a grid. */
    double position_ = 0.0;
    /** Smoothed toward the wanted rate: a hand's positions arrive at 60 Hz and the audio runs at 48 kHz. */
    double rate_ = 0.0;

    /** The record, INTERLEAVED and 16-bit — half the bytes of a float buffer, see docs/turntable.md. */
    std::vector<int16_t> record_;
    /** What one stored sample is worth: a stem is a FLOAT wav and may exceed 1, so it is scaled to fit. */
    float scale_ = 1.0f;
    int frames_ = 0;
    double recordRate_ = 0.0;
    /** Swapped under a lock on the message thread and read by the audio thread — never allocated there. */
    juce::SpinLock recordLock_;

    /** Changes the TEMPO and leaves the pitch where it was — the one thing a varispeed cannot do. */
    tracktion::engine::TimeStretcher stretcher_;
    /** Its two sides, sized in `initialise` and never on the audio thread. */
    juce::AudioBuffer<float> stretchIn_, stretchOut_;
    int stretchReady_ = 0, stretchRead_ = 0;
    /** Record frames swallowed and not yet heard — the stretcher reads AHEAD, and a needle must not. */
    double owed_ = 0.0;
    /** False means the stream is stale — a seek, a scratch, or KEY off — and the next stretched block resets it. */
    bool stretching_ = false;
    /** The last ratio handed over, since setting one re-derives how much input a block wants. */
    float lastRatio_ = 0.0f;

    /** The two edges and the roll's shadow — the arithmetic lives apart, see TurntableLoop.h. */
    TurntableLoop loop_;

    tracktion::engine::AutomatableParameter::Ptr rate_p_, seek_p_, gain_p_, key_p_;
    tracktion::engine::AutomatableParameter::Ptr loopStart_p_, loopEnd_p_, roll_p_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;
    /** The last `Seek` seen, so a REPEATED value is not a jump — a param carries no events, only a level. */
    float lastSeek_ = -1.0f;
    /** The needle, for whoever asks from another thread — written once a block, never read on the audio one. */
    std::atomic<double> needle_{0.0};
};

}  // namespace studio
