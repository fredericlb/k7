// PatternPlugin.h — a Strudel pattern lane, played by the engine: the lane's source in, notes and one-shots out, locked
// to the transport. Heads the lane's chain, so its notes reach the instrument after it (docs/patternPlugin.md).
//
// The one thing a reader would get wrong: nothing here queries Strudel or reads a file on the audio thread while playing
// live. A worker queries ahead into PatternSchedule's ring and loads samples; only an OFFLINE render does either in the
// callback, where time is not real.

#pragma once

#include "PatternSchedule.h"
#include "SampleBanks.h"

#include <tracktion_engine/tracktion_engine.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace studio {

class StrudelHost;

class PatternPlugin : public tracktion::engine::Plugin {
public:
    explicit PatternPlugin(tracktion::engine::PluginCreationInfo info);
    ~PatternPlugin() override;

    static const char* getPluginName() { return "Pattern"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Pattern"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Pattern"; }
    juce::String getSelectableDescription() override { return "Strudel pattern"; }

    // Audio passes through and one-shots are ADDED to it; notes go on to the instrument after this.
    bool takesAudioInput() override { return true; }
    bool canBeAddedToClip() override { return false; }
    bool producesAudioWhenNoAudioInput() override { return playsSamples_; }
    int getNumOutputChannelsGivenInputs(int n) override { return playsSamples_ ? std::max(n, 2) : n; }
    void getChannelNames(juce::StringArray*, juce::StringArray*) override {}

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** How far ahead of the playhead the worker keeps the ring filled. */
    static constexpr double lookaheadSeconds = 0.25;
    /** Distinct sample files one lane may hold; past it a new sound is skipped and said so. */
    static constexpr int maxSamples = 256;
    // A one-shot longer than a minute at 192 kHz is not one: its header is refused rather than trusted to size a buffer.
    static constexpr juce::int64 maxSampleFrames = 60LL * 192000;
    /** One-shots sounding at once; past it the oldest is stolen. */
    static constexpr int maxVoices = 64;
    // The non-note events one block may carry through without the buffer growing on the audio thread.
    static constexpr int maxPassThrough = 256;

protected:
    void valueTreePropertyChanged(juce::ValueTree&, const juce::Identifier&) override;

private:
    class Worker;

    /** One decoded file, at its own rate: a voice steps through it at native / output rate. */
    struct SampleData {
        juce::AudioBuffer<float> audio;
        double rate = 44100.0;
    };

    struct Voice {
        const SampleData* sample = nullptr;
        double pos = 0.0;
        float gain = 1.0f;
        int startOffset = 0;  // samples into the current block; 0 once it is running
    };

    void setSource(const juce::String& source);
    /** Loads the latest source if it is newer than the one evaluated; any thread but the audio one while live. */
    void ensureLoaded();
    /** Queries [from, to) cycles into the ring (`live`, the worker) or straight into the schedule (an offline render). */
    void feed(PatternCursor& cursor, double from, double to, const PatternTempo& tempo, bool live);
    /** The slot holding `path`, loading it on first use; -1 when it cannot be read or the store is full. */
    int sampleSlot(const std::string& path);
    /** Once per distinct message, on the message thread. */
    void warnOnce(const std::string& key, const std::string& message);
    PatternTempo editTempo();
    void renderVoices(const tracktion::engine::PluginRenderContext&);

    PatternSchedule schedule_;
    std::unique_ptr<Worker> worker_;

    // Fixed for the plugin's life: any of these changing is a new plugin (ProjectDiff keyOf).
    std::string label_;
    std::string subject_;
    bool catchAll_ = false;
    std::vector<std::string> claimed_;
    bool playsNotes_ = true;
    bool playsSamples_ = false;
    bool onlyInstance_ = true;  // the lane's only pattern plugin, so what it cannot play is played nowhere
    SampleBanks banks_;

    // Two locks, so a save on the message thread never waits out an evaluation. Neither is taken on the live audio path.
    std::mutex sourceLock_;  // source_, sourceVersion_
    std::string source_;
    uint64_t sourceVersion_ = 0;
    std::mutex hostLock_;  // host_, loadedVersion_, lastError_, the sample store's owning side, warned_
    std::unique_ptr<StrudelHost> host_;
    uint64_t loadedVersion_ = 0;
    std::string lastError_;
    std::set<std::string> warned_;
    std::map<std::string, int> slotOf_;
    std::vector<std::unique_ptr<SampleData>> owned_;
    std::array<std::atomic<const SampleData*>, maxSamples> slots_{};

    std::atomic<bool> rendering_{false};
    std::atomic<bool> panic_{false};
    double sampleRate_ = 48000.0;
    PatternCursor renderCursor_;
    tracktion::engine::MidiMessageArray passThrough_;
    std::array<NoteEvent, 512> events_{};
    std::array<SampleHit, 256> hits_{};
    std::array<Voice, maxVoices> voices_{};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PatternPlugin)
};

}  // namespace studio
