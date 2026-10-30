// SfzPlugin.h — an SFZ instrument as a Tracktion built-in: sfizz plays the `.sfz` a module names, with the
// samples it references read from disk around it. Loaded on a thread of its own, like TurntablePlugin's record, into
// a fresh synth swapped in under a lock the audio thread only ever tries. `@instruments/<name>/…` is THIS
// machine's `<state>/instruments`, filled by the supervisor; one not there yet is waited for. docs/sfzPlugin.md.

#pragma once

// The module header, not a path into a build tree — same reason as WaveformTapPlugin.h.
#include <tracktion_engine/tracktion_engine.h>

#include "Warnings.h"

#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace sfz {
class Sfizz;
}

namespace studio {

class SfzPlugin : public tracktion::engine::Plugin, private juce::Timer {
public:
    explicit SfzPlugin(tracktion::engine::PluginCreationInfo info);
    ~SfzPlugin() override;

    static const char* getPluginName() { return "SFZ Player"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    // --- Plugin interface ---------------------------------------------------

    juce::String getName() const override { return getPluginName(); }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "SFZ"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    bool takesAudioInput() override { return false; }
    bool takesMidiInput() override { return true; }
    bool isSynth() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return true; }
    // A struck string rings on past its note-off, and its release samples are part of the sound.
    bool noTail() override { return false; }
    // Two per output pair: one unless some key leaves by a pair of its own (docs/tapOutputs.md).
    int getNumOutputChannelsGivenInputs(int) override { return 2 * pairs_; }
    // …and a name per channel of them: a RackType refuses a connection from a pin past the plugin's names.
    void getChannelNames(juce::StringArray* ins, juce::StringArray* outs) override;

    /** Which keys leave by which output pair, as `{note, pair}`; set BEFORE the instrument loads and the graph is built. */
    void setKeyOutputs(const std::vector<std::pair<int, int>>& noteToPair);

    void initialise(const tracktion::engine::PluginInitialisationInfo& info) override;
    void deinitialise() override;
    void reset() override;
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext& ctx) override;

    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    // --- level ---------------------------------------------------------------

    tracktion::engine::AutomatableParameter::Ptr volumeDb;
    juce::CachedValue<float> volumeDbValue;

    // A gain per KEY, `Key 0`…`Key 127` in dB, added to the voices that note starts: a kit's pad louder than the rest.
    std::vector<tracktion::engine::AutomatableParameter::Ptr> keyGains;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> keyGainValues;
    // …and a MUTE per key, `Mute 0`…`Mute 127`, on at 0.5 and over: that note starts no voice, whatever its gain.
    std::vector<tracktion::engine::AutomatableParameter::Ptr> keyMutes;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> keyMuteValues;

    // --- instrument ----------------------------------------------------------

    // Load the instrument `path` names into a new synth and swap it in, OFF the message thread: a missing or quarantined
    // file answers false at once, a load that fails later warns for `subject`. One not downloaded yet is waited for.
    bool loadInstrument(const juce::String& path, juce::String& error, const std::string& subject = {});

    /** Where `path` is on this machine: an `@instruments/…` ref under `<state>/instruments`, anything else as written. */
    static juce::File resolve(const juce::String& path);

    /** Whether `path` can load here: an `@instruments/…` ref needs its file AND its folder's install marker. */
    static bool installed(const juce::String& path);

private:
    // The live synth, swapped under `lock_` — which the audio thread only TRIES, since blocking is a dropout.
    mutable juce::SpinLock lock_;
    std::unique_ptr<sfz::Sfizz> synth_;
    juce::String path_;

    // What the synth was last prepared with, so one loaded AFTER initialise() gets the same shape; written under `lock_`.
    double sampleRate_ = 44100.0;

    // Set off the audio thread, answered on it: a panic silences the synth between two blocks.
    std::atomic<bool> silencePending_{false};
    // Whether the live synth is free-wheeling, flipped only when a render starts or stops.
    bool freeWheeling_ = false;

    // The rendered pairs, sized once in initialise() and never in applyToBuffer.
    juce::AudioBuffer<float> out_;

    // The keys routed to a pair of their own, and how many pairs that makes (docs/tapOutputs.md).
    static constexpr int MAX_PAIRS = 16;
    std::vector<std::pair<int, int>> keyOuts_;
    int pairs_ = 1;

    void prepare(sfz::Sfizz& synth) const;
    bool loadNow(const juce::File& file, juce::String& error);
    // The parse and preload, on `loader_`; it swaps the synth in only if `gen` is still the latest request.
    void loadOnWorker(const juce::File& file, int gen, double rate, std::vector<std::pair<int, int>> keyOuts,
                      const std::string& subject);

    // One load at a time, off the message thread; the generation says which request is the latest (docs/sfzPlugin.md).
    juce::ThreadPool loader_{1};
    std::atomic<int> loadGen_{0};
    std::atomic<int> loadsPending_{0};
    // Who a failed load is reported for: the module's id, as the builder passed it, and the project it is in.
    std::string subject_;
    WarningOrigin origin_;

    // An `@instruments/` file still downloading: checked every 2 s, and loaded the moment it is there.
    juce::String waitingFor_;
    void timerCallback() override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SfzPlugin)
};

}  // namespace studio
