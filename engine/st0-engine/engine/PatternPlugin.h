// PatternPlugin.h — a Strudel pattern lane played BY THE ENGINE: the lane's source in, notes out, locked to the transport.
// Sits first on the lane's MIDI chain, so what it plays reaches the instrument after it (docs/patternPlugin.md).
//
// The one thing a reader would get wrong: nothing here queries Strudel on the audio thread while playing live. A worker
// queries ahead into PatternSchedule's ring; only an OFFLINE render queries in the callback, where time is not real.

#pragma once

#include "PatternSchedule.h"

#include <tracktion_engine/tracktion_engine.h>

#include <array>
#include <atomic>
#include <memory>
#include <mutex>
#include <string>

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

    // A note SOURCE, answered like the arpeggiator: no audio in, none out, notes through.
    bool takesAudioInput() override { return false; }
    bool canBeAddedToClip() override { return false; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    int getNumOutputChannelsGivenInputs(int n) override { return n; }
    void getChannelNames(juce::StringArray*, juce::StringArray*) override {}

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** How far ahead of the playhead the worker keeps the ring filled. */
    static constexpr double lookaheadSeconds = 0.25;

protected:
    void valueTreePropertyChanged(juce::ValueTree&, const juce::Identifier&) override;

private:
    class Worker;

    /** The pattern source changed: the next query evaluates it, and the lane keeps playing the old one until then. */
    void setSource(const juce::String& source);
    /** Loads the latest source if it is newer than the one evaluated; any thread but the audio one while live. */
    void ensureLoaded();
    /** Queries [from, to) cycles into the ring (`live`, the worker) or straight into the schedule (an offline render). */
    void feed(PatternCursor& cursor, double from, double to, const PatternTempo& tempo, bool live);
    PatternTempo editTempo();

    PatternSchedule schedule_;
    std::unique_ptr<Worker> worker_;

    // Two locks, so a save on the message thread never waits out an evaluation. Neither is taken on the live audio path.
    std::mutex sourceLock_;  // source_, sourceVersion_
    std::string source_;
    uint64_t sourceVersion_ = 0;
    std::mutex hostLock_;  // host_, loadedVersion_, lastError_
    std::unique_ptr<StrudelHost> host_;
    uint64_t loadedVersion_ = 0;
    std::string lastError_;
    std::string label_;    // fixed for the plugin's life: a new label is a new plugin (ProjectDiff keyOf)
    std::string subject_;  // the PluginDoc id warnings are attached to

    std::atomic<bool> rendering_{false};
    std::atomic<bool> panic_{false};
    PatternCursor renderCursor_;
    tracktion::engine::MidiMessageArray passThrough_;
    std::array<NoteEvent, 512> events_{};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PatternPlugin)
};

}  // namespace studio
