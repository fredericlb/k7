#include "EngineHost.h"

#include "MasterGainPlugin.h"

#include "EngineTypes.h"       // Tracktion/JUCE + the te/tt/fs aliases
#include "EngineHostImpl.h"    // struct EngineHost::Impl (the PImpl state)
#include "PluginParams.h"      // namedParams / allParams / applyPluginParams / paramsJson / …
#include "PluginScan.h"        // cachedPluginInfos / invalidatePluginInfoMemo
#include "EditBuilder.h"       // populateEdit / trackById / addPlugin / applyTrackParams / …
#include "AudioInputs.h"       // findWaveInput / monitorModeOf / findTrackInput
#include "NamPlugin.h"          // the neural amp modeller (a .nam model as a plugin)
#include "BroadcastTapPlugin.h" // the transparent tap plugin for network broadcast
#include "WaveformTapPlugin.h" // the transparent tap plugin for waveform display
#include "TurntablePlugin.h"   // the platter, which carries a clock of its own
#include "Warnings.h"          // WarningScope — which project an apply's warnings belong to
#include "MessagePump.h"       // pumpMessages — the loop run() spins, where one may be spun

#include <algorithm>
#include <iostream>
#include <map>
#include <utility>
#include <vector>

namespace studio {

// API NOTE — pinned to Tracktion Engine v3.2.0 (CMakeLists.txt): model types are tracktion::engine (te), the time types (TimePosition/TimeRange/BeatPosition) tracktion (tt).

EngineHost::EngineHost() : impl_(std::make_unique<Impl>()) {
    // The audio device is deliberately NOT opened here — see openAudioDevice(), so main() binds the WebSocket port first.

    // Our built-ins plus the two Tracktion ships unregistered, shared with the offline paths, which need the same set — see registerBuiltInPlugins.
    registerBuiltInPlugins(impl_->engine);
}

const ProjectDoc& EngineHost::current(const std::string& session) const {
    // A session nobody has sent a project to holds the empty doc — asking about one must not make it.
    static const ProjectDoc kEmpty{};
    auto* s = impl_->find(session);
    return s ? s->current : kEmpty;
}

void EngineHost::openAudioDevice() {
    // Open the interface once, INPUTS included — with none open the callback delivers no input samples and every input meters -100 for ever. docs/engineHost.md.
    auto& dm = impl_->engine.getDeviceManager();
    // 512 is Tracktion's own default, and means "as many channels as the device has" — asked of the OUTPUTS too, since a cue bus leaves by a second pair (docs/cueOutput.md).
    dm.initialise(512, 512);
    // …then onto the buffer this engine asks for, which decides its quality band; after initialise, because there is no device to ask before it.
    applyPreferredBufferSize(dm.deviceManager);
    publishAudioTiming();   // what whoami answers with, from now on — see AudioDevices.cpp
    if (auto* dev = dm.deviceManager.getCurrentAudioDevice())
        std::cerr << "[device] '" << dev->getName() << "' open: "
                  << dev->getActiveInputChannels().countNumberOfSetBits() << " in, "
                  << dev->getActiveOutputChannels().countNumberOfSetBits() << " out\n";
}

EngineHost::~EngineHost() {
    if (impl_) {
        // The tuner FIRST: a live audio callback must stop being called before anything it reads through goes away.
        if (impl_->tunerAttached)
            impl_->engine.getDeviceManager().deviceManager.removeAudioCallback(&impl_->tuner);
        // EVERY session, the destructor being nobody's in particular: the teardown an apply does before its Edit dies, since ~Edit calls the record listener it would otherwise outlive.
        for (const auto& id : impl_->ids()) {
            enableBroadcast(id, false);
            teardownProjectState(id);
        }
        impl_->detachInputClients();   // and input clients before the devices (their measurers) do
    }
}

void EngineHost::teardownProjectState(const std::string& session) {
    // Close plugin editors and drop plugin refs BEFORE the old edit is destroyed: the windows own editors pointing at those plugins.
    impl_->session(session).pluginWindows.clear();
    impl_->session(session).pluginsById.clear();
    impl_->session(session).presetSaveById.clear();
    impl_->session(session).lastSavedState.clear();
    impl_->session(session).detachLevelMeters();   // unregister clients before their measurers die
    impl_->session(session).waveformPlugins.clear();  // release taps before the edit dies
    // The broadcast PLUGIN goes with them; the ring and `broadcastWanted` stay, so buildLevelMeters re-taps the new edit and a listener survives an apply.
    impl_->session(session).broadcastPlugin = nullptr;
    // The transport dies with the edit, so drop the listener while there is still something to drop it from.
    if (impl_->session(session).recordListener)
        if (auto* tc = impl_->transport(session))
            tc->removeListener(impl_->session(session).recordListener.get());
    impl_->session(session).pendingTakes.clear();
    // Keep the WATCHES — interest in an id outlives the plugin behind it — but drop their baselines, or a parameter that came back different would be diffed away.
    for (auto& [id, lastSent] : impl_->session(session).watchedParams)
        lastSent.clear();
}

void EngineHost::reset(const std::string& session) {
    stop(session);                    // halt the transport before the graph under it goes away
    teardownProjectState(session);
    impl_->session(session).edit.reset();       // destroys the playback context and every plugin in it
    impl_->session(session).current = ProjectDoc{};   // empty baseline → the next apply() is a full build
    impl_->session(session).baseDir.clear();
    std::cerr << "[reset] project state flushed\n";
}

void EngineHost::applyFull(const std::string& session, const ProjectDoc& doc, const std::string& baseDir) {
    // Building a graph is where nearly every warning comes from, so name the project they are about for as long as the build runs.
    WarningScope ws{session};
    impl_->session(session).lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
    teardownProjectState(session);
    invalidatePluginInfoMemo();   // reload the scan cache once per apply, then memoise it across this apply's per-plugin lookups

    // Time the phases the first play waits on — the edit graph, every plugin, the playback context — printed once per apply, so a slow start shows in the log.
    const double t0 = juce::Time::getMillisecondCounterHiRes();
    impl_->session(session).edit = te::Edit::createSingleTrackEdit(impl_->engine);
    auto* edit = impl_->session(session).edit.get();
    auto* tc = impl_->transport(session);
    if (edit == nullptr || tc == nullptr) {   // every other transport call in this file guards; this one did not
        studio::warn("could not create an edit for this project");
        return;
    }
    const double t1 = juce::Time::getMillisecondCounterHiRes();
    populateEdit(impl_->engine, *edit, doc, baseDir, &impl_->session(session).pluginsById, &impl_->session(session).presetSaveById);
    const double t2 = juce::Time::getMillisecondCounterHiRes();
    buildLevelMeters(session);           // append a metering plugin + client to each track
    // …and point every recorder node back at the ring the SESSION owns, so a take in progress
    // survives the rebuild that just replaced the plugin writing it (docs/recorder.md).
    attachRecorderTaps(session);
    // A fresh Edit starts with no click, so re-assert the metronome flag, or every apply would silence it.
    applyMetronome(session);
    const double t3 = juce::Time::getMillisecondCounterHiRes();

    // EVERY graph-invalidating call is above this line: allocate the context first and the graph builds twice, the second build being the freeze. docs/audit-stabilite.md.
    tc->ensureContextAllocated();
    const double t4 = juce::Time::getMillisecondCounterHiRes();

    impl_->session(session).current = doc;
    // The song's output level, on the gain buildLevelMeters just put on the master list; here rather than there, because HERE is where `doc` is the truth.
    if (auto* mg = dynamic_cast<studio::MasterGainPlugin*>(
            impl_->session(session).masterGain.get()))
        mg->setGainDb(doc.masterVolume);
    impl_->session(session).baseDir = baseDir;
    // Live inputs need the context ensureContextAllocated() just made, and map ids through `current`.
    applyAllTrackInputs(session, doc);
    // …and the tracks that leave by a pair of their own, which a rebuild has just put back on the mixer's sum.
    applyAllTrackOutputs(session, doc);

    // Re-attach the record listener to this edit's transport — the previous edit's went with its listener list. Defined in Recording.cpp.
    attachRecordListener(session);

    // Drain whatever the input pass still queued HERE, where it is timed and before anyone is told the project is ready — not on Edit's 1 ms timer.
    const double t5 = juce::Time::getMillisecondCounterHiRes();
    edit->dispatchPendingUpdatesSynchronously();
    const double t6 = juce::Time::getMillisecondCounterHiRes();

    std::cerr << "[applyFull] createEdit=" << (t1 - t0) << "ms populate=" << (t2 - t1)
              << "ms meters+click=" << (t3 - t2) << "ms ensureContext=" << (t4 - t3)
              << "ms inputs=" << (t5 - t4) << "ms settle=" << (t6 - t5)
              << "ms total=" << (t6 - t0) << "ms plugins=" << impl_->session(session).pluginsById.size() << "\n";
}

// Append a post-fader LevelMeterPlugin to every audio track and attach the VU client; called after a full rebuild, the incremental path leaving meters alone.
void EngineHost::buildLevelMeters(const std::string& session) {
    impl_->session(session).detachLevelMeters();
    if (!impl_->session(session).edit) return;
    auto audioTracks = te::getAudioTracks(*impl_->session(session).edit);
    for (int i = 0; i < audioTracks.size(); ++i) {
        auto* track = audioTracks[i];
        auto meter = impl_->session(session).edit->getPluginCache().createNewPlugin(te::LevelMeterPlugin::xmlTypeName, {});
        auto* lm = dynamic_cast<te::LevelMeterPlugin*>(meter.get());
        if (lm == nullptr) continue;
        track->pluginList.insertPlugin(meter, -1, nullptr);   // -1 == append, so it meters the final output
        auto client = std::make_unique<te::LevelMeasurer::Client>();
        lm->measurer.addClient(*client);
        impl_->session(session).levelMeters.push_back(meter);
        impl_->session(session).levelClients.push_back(std::move(client));
    }

    /** The song's OUTPUT LEVEL — the OUT node's `Volume`, FOUND rather than made, since populateEdit put it there; everything below goes on AFTER it. docs/engineHost.md. */
    impl_->session(session).masterGain = studio::masterGainOf(*impl_->session(session).edit);

    // …and one meter on the master list after that gain: an output DEVICE carries no measurer in Tracktion, so this plugin is the only place the level can be read.
    auto master = impl_->session(session).edit->getPluginCache().createNewPlugin(te::LevelMeterPlugin::xmlTypeName, {});
    if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(master.get())) {
        impl_->session(session).edit->getMasterPluginList().insertPlugin(master, -1, nullptr);
        impl_->session(session).masterClient = std::make_unique<te::LevelMeasurer::Client>();
        lm->measurer.addClient(*impl_->session(session).masterClient);
        // …and the state frame's own, so the two readers do not clear each other. See EngineHostImpl.
        impl_->session(session).masterStateClient = std::make_unique<te::LevelMeasurer::Client>();
        lm->measurer.addClient(*impl_->session(session).masterStateClient);
        impl_->session(session).masterMeter = master;
    }

    // The broadcast tap goes back on the same list: a rebuild drops every plugin, so the WISH is what survives — without this, saving a file silences every listener.
    if (impl_->session(session).broadcastWanted) {
        impl_->session(session).broadcastPlugin = nullptr;
        enableBroadcast(session, true);
    }
}

float EngineHost::masterLevelDb(const std::string& session) const {
    auto* s = impl_->find(session);
    if (s == nullptr || !s->masterClient) return -100.0f;
    auto& client = *s->masterClient;
    const float l = client.getAndClearAudioLevel(0).dB;
    const float r = client.getAndClearAudioLevel(1).dB;
    return std::max(l, r);
}

/** The master output as the 20 Hz frame reports it, on its own client so `io-levels` is not emptied; the overload is DEDUCED from a peak that latches. docs/engineHost.md. */
EngineHost::MasterLevel EngineHost::masterState(const std::string& session) const {
    auto* s = impl_->find(session);
    if (s == nullptr || !s->masterStateClient) return {-100.0f, false};
    auto& client = *s->masterStateClient;
    // Both read unconditionally: reading CLEARS, so skipping one would carry its peak into the next frame and report a clip a window late.
    const float l = client.getAndClearAudioLevel(0).dB;
    const float r = client.getAndClearAudioLevel(1).dB;
    const float peak = std::max(l, r);
    // 0 dB, which is Tracktion's own threshold: processBuffer overloads a channel above 0.999.
    return {peak, peak > 0.0f};
}

// Drop the clip a ClipDoc names, by the PLACEMENT id `clipNameFor` spells (docs/clipIdentity.md); iterating a COPY, since removeFromParent() mutates the live list.
static void removeClipFor(te::AudioTrack& t, const ClipDoc& c) {
    const juce::String name = juce::String(clipNameFor(c));
    auto clips = t.getClips();
    for (auto* clip : clips)
        if (clip != nullptr && clip->getName() == name) {
            clip->removeFromParent();
            break;
        }
}

ProjectDiff EngineHost::apply(const std::string& session, const ProjectDoc& target, const std::string& baseDir) {
    WarningScope ws{session};   // same reason as applyFull, for the incremental path
    impl_->session(session).lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
    ProjectDiff d = diff(impl_->session(session).current, target);

    // No live edit yet, or a change the incremental path can't handle: rebuild.
    if (!impl_->session(session).edit || needsFullRebuild(d)) {
        applyFull(session, target, baseDir);   // sets impl_->session(session).current = target
        return d;
    }

    auto& engine = impl_->engine;
    auto& edit = *impl_->session(session).edit;
    impl_->session(session).baseDir = baseDir;

    for (const auto& c : d) {
        switch (c.kind) {
            case ChangeKind::TempoChanged:
                edit.tempoSequence.getTempo(0)->setBpm(c.doubleValue);
                break;
            // In place, which is the point of it having a change at all: a rebuild replaces the Edit and the transport with it, so it would stop the song.
            case ChangeKind::MasterVolumeChanged:
                if (auto* mg = dynamic_cast<studio::MasterGainPlugin*>(
                        impl_->session(session).masterGain.get()))
                    mg->setGainDb(static_cast<float>(c.doubleValue));
                break;
            case ChangeKind::TimeSignatureChanged:
                if (auto* ts = edit.tempoSequence.getTimeSig(0)) {
                    ts->numerator = c.intA;
                    ts->denominator = c.intB;
                }
                break;
            case ChangeKind::TrackAdded:
                edit.ensureNumberOfAudioTracks(te::getAudioTracks(edit).size() + 1);
                if (auto* t = te::getAudioTracks(edit).getLast(); t && c.track)
                    t->setName(juce::String(c.track->name));
                break;
            case ChangeKind::TrackRenamed:
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.track)
                    t->setName(juce::String(c.track->name));
                break;
            case ChangeKind::TrackParamsChanged:
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.track)
                    applyTrackParams(*t, *c.track);
                break;
            case ChangeKind::TrackInputChanged:
            case ChangeKind::TrackOutputChanged:
                break;  // deferred to after the loop — see below
            case ChangeKind::ClipAdded:
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.clip) {
                    if (c.clip->type == ClipType::Midi) insertMidiClip(edit, *t, *c.clip);
                    else insertClip(engine, edit, *t, *c.clip, baseDir);
                }
                break;

            case ChangeKind::ClipRemoved:
                // What lets a live-streamed pattern prune played clips instead of accumulating them.
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.clip)
                    removeClipFor(*t, *c.clip);
                break;
            case ChangeKind::ClipMoved:
                // Re-INSERT, not reposition: everything a clip carries is applied at insert time, so setStart/setLength would drop all but two. docs/engineHost.md.
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.clip) {
                    removeClipFor(*t, *c.clip);
                    if (c.clip->type == ClipType::Midi) insertMidiClip(edit, *t, *c.clip);
                    else insertClip(engine, edit, *t, *c.clip, baseDir);
                }
                break;
            /** The one new plugin into the LIVE track rather than a whole rebuild, positioned off the LIVE plugin list; whatever does not hold falls back. docs/engineHost.md. */
            case ChangeKind::PluginAdded: {
                const auto rebuild = [&] { applyFull(session, target, baseDir); };
                auto* t = trackById(edit, c.trackId, impl_->session(session).current);
                const TrackDoc* td = nullptr;
                for (const auto& x : target.tracks)
                    if (x.id == c.trackId) { td = &x; break; }
                if (t == nullptr || td == nullptr || !c.plugin) { rebuild(); return d; }

                // A tap between the modules makes "after the previous one" ambiguous, and is rare enough not to guess at, so the rebuild takes it.
                for (int i = 0; i < t->pluginList.size(); ++i)
                    if (dynamic_cast<WaveformTapPlugin*>(t->pluginList[i]) != nullptr) { rebuild(); return d; }

                int docPos = -1;
                for (size_t i = 0; i < td->plugins.size(); ++i)
                    if (td->plugins[i].id == c.plugin->id) { docPos = static_cast<int>(i); break; }
                if (docPos < 0) { rebuild(); return d; }

                int at = 0;   // first in the chain: the front, exactly where populateEdit would put it
                if (docPos > 0) {
                    auto prev = impl_->session(session).pluginsById.find(td->plugins[docPos - 1].id);
                    if (prev == impl_->session(session).pluginsById.end() || prev->second == nullptr) {
                        rebuild();
                        return d;
                    }
                    const int prevIdx = t->pluginList.indexOf(prev->second.get());
                    if (prevIdx < 0) { rebuild(); return d; }
                    at = prevIdx + 1;
                }

                auto pl = addPlugin(edit, *t, *c.plugin, at);
                // Null means it could not be instantiated — already warned by addPlugin, and a rebuild would fail identically, so leave the rest of the song playing.
                if (pl == nullptr) break;
                impl_->session(session).pluginsById[c.plugin->id] = pl;
                if (!c.plugin->presetSave.empty())
                    impl_->session(session).presetSaveById[c.plugin->id] = c.plugin->presetSave;
                break;
            }

            case ChangeKind::TrackRemoved:
                break;  // unreachable (handled by needsFullRebuild above), like SampleRateChanged
            /** Take the one plugin out of the LIVE chain: a rebuild replaces the Edit and the transport with it, so unlinking a module would stop the song. */
            case ChangeKind::PluginRemoved: {
                if (!c.plugin) break;
                auto& s = impl_->session(session);
                auto it = s.pluginsById.find(c.plugin->id);
                // Absent from the graph: it never instantiated, so there is nothing to remove and a rebuild would produce the same nothing more slowly.
                if (it == s.pluginsById.end() || it->second == nullptr) {
                    s.pluginsById.erase(c.plugin->id);
                    break;
                }
                // Its own waveform taps go WITH it: left behind they would measure its neighbours while claiming to be its input and output.
                for (const char* side : {"input", "output"})
                    disableWaveformTap(session, c.plugin->id, side);
                // The editor window points at the plugin, so it closes first — the order teardownProjectState observes for exactly this reason.
                s.pluginWindows.erase(c.plugin->id);
                it->second->deleteFromParent();
                s.pluginsById.erase(it);
                s.presetSaveById.erase(c.plugin->id);
                s.lastSavedState.erase(c.plugin->id);
                // watchedParams is deliberately NOT cleared: a client's interest in an id outlives the plugin behind it, exactly as across a rebuild.
                break;
            }
            case ChangeKind::PluginParamChanged:
                // One per differing parameter, keyed by the display name applyPluginParams() and namedParams() share; an id absent from the edit failed to instantiate.
                if (c.plugin)
                    if (auto it = impl_->session(session).pluginsById.find(c.plugin->id);
                        it != impl_->session(session).pluginsById.end() && it->second != nullptr)
                        applyPluginParams(*it->second, {{c.paramName, c.paramValue}});
                break;
            case ChangeKind::PluginEnabledChanged:
                // Bypass on the LIVE plugin, which stays in the chain passing its input through; deliberately not a rebuild, which would restart every other plugin.
                if (c.plugin)
                    if (auto it = impl_->session(session).pluginsById.find(c.plugin->id);
                        it != impl_->session(session).pluginsById.end() && it->second != nullptr)
                        it->second->setEnabled(c.enabled);
                break;
            case ChangeKind::AutomationChanged:
                // Re-bake the lane onto its target plugin's parameter curve, keyed by the plugin id it carries; one absent from the edit is skipped, like a param change.
                if (c.automation)
                    if (auto it = impl_->session(session).pluginsById.find(c.automation->pluginId);
                        it != impl_->session(session).pluginsById.end() && it->second != nullptr)
                        applyAutomationLane(edit, *it->second, *c.automation);
                break;
            case ChangeKind::SampleRateChanged:
                break;  // unreachable (handled by needsFullRebuild above)
        }
    }

    // Solo is global, and a per-track diff carries only the changed track — so re-apply mute across all of them.
    applySoloMute(edit, target);

    // The engine now reflects `target` for every implemented change kind, so adopt it as the next diff's baseline.
    impl_->session(session).current = target;
    impl_->session(session).baseDir = baseDir;

    // Re-assert the click: the metronome flag is not a tracked ChangeKind, so a toggle arrives as an otherwise-empty diff, applied here like solo and mute above.
    applyMetronome(session);

    // Inputs go last, once `current` is the new baseline: applyTrackInput maps a track id to its lane THROUGH it, and a track this diff added exists only in `target`.
    for (const auto& c : d)
        if (c.kind == ChangeKind::TrackInputChanged && c.track)
            applyTrackInput(session, *c.track);
    // Outputs for the same reason, and after them because enabling an output device rebuilds the wave list under both.
    for (const auto& c : d)
        if (c.kind == ChangeKind::TrackOutputChanged && c.track)
            applyTrackOutput(session, *c.track);
    return d;
}

// The count-in in bars, mapped to Tracktion's CountIn enum, which caps at two (0 means none); during one it rolls those bars and clicks them, metronome or not.
static te::Edit::CountIn countInModeFor(int bars) {
    if (bars <= 0) return te::Edit::CountIn::none;
    if (bars == 1) return te::Edit::CountIn::oneBar;
    return te::Edit::CountIn::twoBar;
}

// Play — and record the armed tracks if THIS SESSION's enable is on; arming alone only marks a track as wanting to, so tracks can stay armed while auditioning.
void EngineHost::play(const std::string& session) {
    auto* tc = impl_->transport(session);
    if (tc == nullptr) return;

    // `setCountInMode` is engine-GLOBAL rather than an Edit property and writes Settings.xml, hence the guard and why it stays inside the transport calls. docs/engineHost.md.
    const auto setCountIn = [this, &session](te::Edit::CountIn mode) {
        auto* edit = impl_->session(session).edit.get();
        if (edit == nullptr || impl_->countInApplied == (int)mode) return;
        edit->setCountInMode(mode);
        impl_->countInApplied = (int)mode;
    };

    // A loop always starts from its top, so drop the playhead onto the start; Tracktion wraps back on its own.
    if (tc->looping) tc->setPosition(tc->getLoopRange().getStart());
    if (impl_->session(session).recordEnabled && prepareTakes(session)) {
        // Count-in applies to the record roll only, so a plain play clears it and an earlier record's count cannot linger onto ordinary playback.
        setCountIn(countInModeFor(impl_->session(session).current.countIn));
        // The armed track is muted at the punch-in by RecordListener::recordingStarted, not here: the old clips stay audible through the count-in (docs/engineHost.md).
        tc->record(false);
    } else {
        setCountIn(te::Edit::CountIn::none);
        tc->play(false);
    }
}
// Creating, unlike the readers around it: a client saying "rolling me records" is declaring it drives this project, the same way subscribing to its audio is.
void EngineHost::setRecordEnabled(const std::string& session, bool on) {
    impl_->session(session).recordEnabled = on;
    // Named, because two services on one engine are otherwise indistinguishable in the log.
    std::cerr << "[rec] record " << (on ? "enabled" : "disabled") << " for '" << session << "'\n";
}
bool EngineHost::recordEnabled(const std::string& session) const {
    auto* s = impl_->find(session);
    return s != nullptr && s->recordEnabled;
}

// find(), not session(): asking whether a session is being watched must not conjure one.
bool EngineHost::sessionWatched(const std::string& session) const {
    auto* s = impl_->find(session);
    return s != nullptr && (!s->waveformPlugins.empty() || !s->watchedParams.empty());
}

// Project the doc's metronome flag onto the click track, reading `current`, which every apply path sets first; emphasise-bars stays on always, being the feature itself.
void EngineHost::applyMetronome(const std::string& session) {
    if (!impl_->session(session).edit) return;
    impl_->session(session).edit->clickTrackEnabled = impl_->session(session).current.metronome;
    impl_->session(session).edit->clickTrackEmphasiseBars = true;
    // The level through Tracktion's setter, which clamps to 0.2..1 and remembers it in property storage; the doc still wins, this running on every apply.
    impl_->session(session).edit->setClickTrackVolume(
        (float) impl_->session(session).current.metronomeLevel);
}
// Stopping the transport stops FEEDING the graph, which is not the same as ending the notes already
// in it: a note-on delivered before the stop has no note-off coming, and the chord hangs. So every
// stop lets go — the notes, and not the tails. See docs/panic.md.
void EngineHost::stop(const std::string& session) {
    if (auto* tc = impl_->transport(session)) tc->stop(false, false);
    if (auto& s = impl_->session(session); s.edit) {
        te::midiPanic(*s.edit, false);
        // A stop ends the take, so restore the mute the record roll applied at the punch-in (docs/engineHost.md).
        applySoloMute(*s.edit, s.current);
    }
}

// …and the one for a stop that did not work: the same, plus reset(), which is what kills a reverb
// tail and re-seats a plugin whose own state is stuck. Two gestures, one flag apart (docs/panic.md).
void EngineHost::panic(const std::string& session) {
    if (auto* tc = impl_->transport(session)) tc->stop(false, false);
    if (auto& s = impl_->session(session); s.edit) te::midiPanic(*s.edit, true);
}
void EngineHost::rewind(const std::string& session) { if (auto* tc = impl_->transport(session)) tc->setPosition(tt::TimePosition()); }

// Set the loop region and enable or disable looping; `enabled` false keeps the range, so re-enabling reuses it.
void EngineHost::setLoop(const std::string& session, double startSeconds, double endSeconds, bool enabled) {
    auto* tc = impl_->transport(session);
    if (tc == nullptr) return;
    tc->setLoopRange(tt::TimeRange::between(tt::TimePosition::fromSeconds(startSeconds),
                                            tt::TimePosition::fromSeconds(endSeconds)));
    tc->looping = enabled;
}

// Scrub to an absolute position in seconds; Tracktion keeps playing from the new spot if the transport rolls.
void EngineHost::seek(const std::string& session, double seconds) {
    if (auto* tc = impl_->transport(session))
        tc->setPosition(tt::TimePosition::fromSeconds(std::max(0.0, seconds)));
}

bool EngineHost::isPlaying(const std::string& session) const {
    auto* tc = impl_->transport(session);
    return tc && tc->isPlaying();
}

double EngineHost::playheadSeconds(const std::string& session) const {
    auto* tc = impl_->transport(session);
    return tc ? tc->getPosition().inSeconds() : 0.0;
}

// --- Sample preview -----------------------------------------------------------

namespace {
constexpr int kPreviewNote = 72;   // the sampler's default keyNote — plays at native pitch
const juce::String kPreviewTrackName = "__studio_preview__";

// Find, or lazily create, the hidden sampler behind the editor's play buttons: an extra track at the END of the edit, outside the doc, so no doc index shifts.
te::SamplerPlugin* ensurePreviewSampler(te::Edit& edit) {
    te::AudioTrack* track = nullptr;
    for (auto* t : te::getAudioTracks(edit))
        if (t != nullptr && t->getName() == kPreviewTrackName) { track = t; break; }
    if (track == nullptr) {
        auto created =
            edit.insertNewAudioTrack(te::TrackInsertPoint::getEndOfTracks(edit), nullptr);
        track = created.get();
        if (track == nullptr) return nullptr;
        track->setName(kPreviewTrackName);
    }
    auto samplers = track->pluginList.getPluginsOfType<te::SamplerPlugin>();
    if (! samplers.isEmpty()) return samplers.getFirst();
    auto plugin = edit.getPluginCache().createNewPlugin(te::SamplerPlugin::xmlTypeName, {});
    track->pluginList.insertPlugin(plugin, 0, nullptr);
    return dynamic_cast<te::SamplerPlugin*>(plugin.get());
}
}  // namespace

void EngineHost::previewSample(const std::string& session, const std::string& file, double startSeconds,
                               double lengthSeconds) {
    if (! impl_->session(session).edit) return;   // nothing loaded — nothing to play through
    auto& edit = *impl_->session(session).edit;
    // SamplerPlugin resolves its source through a SourceFileReference, which needs this resolver for an absolute path; already set on a built edit, set again defensively.
    edit.filePathResolver = [](const juce::String& s) { return juce::File(s); };
    auto* sampler = ensurePreviewSampler(edit);
    if (sampler == nullptr) return;
    sampler->allNotesOff();
    for (int i = sampler->getNumSounds(); --i >= 0;) sampler->removeSound(i);
    if (! addRackSound(edit, *sampler, file, "preview", kPreviewNote, startSeconds,
                       lengthSeconds))
        return;
    // addSound loads asynchronously, so fire the note on the NEXT message-thread turn; the ref-counted handle keeps the plugin alive if the edit goes meanwhile.
    te::Plugin::Ptr keepAlive{sampler};
    juce::MessageManager::callAsync([keepAlive] {
        if (auto* s = dynamic_cast<te::SamplerPlugin*>(keepAlive.get())) {
            juce::BigInteger keys;
            keys.setBit(kPreviewNote);
            s->allNotesOff();   // clear the highlight so an identical note retriggers
            s->playNotes(keys);
        }
    });
}

void EngineHost::previewNote(const std::string& session, const std::string& trackId, int key,
                             float velocity) {
    auto* s = impl_->find(session);
    if (s == nullptr || ! s->edit) return;   // nothing loaded — nothing to play through
    auto* track = trackById(*s->edit, trackId, s->current);
    if (track == nullptr) return;
    // Never 0: a note-on with velocity 0 IS a note-off, so the quietest audition would be silence.
    const int vel = juce::jlimit(1, 127, (int) std::lround(velocity * 127.0f));
    // playGuideNote owns the note-off on a 100 ms timer, and forceNote skips a preference about a HOST's keyboard (docs/protocol.md).
    track->playGuideNote(juce::jlimit(0, 127, key), te::MidiChannel(1), vel, true, true, true);
}

float EngineHost::trackLevelDb(const std::string& session, int trackIndex) const {
    // Peak dB since the last poll, off the track's LevelMeterPlugin client; reading CLEARS, so each poll is a fresh peak. -100 dB when there is no meter yet.
    auto* s = impl_->find(session);
    if (s == nullptr || trackIndex < 0 || trackIndex >= (int)s->levelClients.size())
        return -100.0f;
    auto& client = *s->levelClients[static_cast<size_t>(trackIndex)];
    const float l = client.getAndClearAudioLevel(0).dB;
    const float r = client.getAndClearAudioLevel(1).dB;
    return std::max(l, r);
}

// --- Waveform taps -----------------------------------------------------------

// The id format is "chain:module": extract the module name to find its plugin in the track's chain.
static std::string moduleNameFromId(const std::string& id) {
    const auto pos = id.find(':');
    return pos != std::string::npos ? id.substr(pos + 1) : id;
}

void EngineHost::enableWaveformTap(const std::string& session, const std::string& id, const std::string& side) {
    const std::string key = id + ":" + side;
    if (impl_->session(session).waveformPlugins.count(key)) return;  // already active
    if (!impl_->session(session).edit) return;

    // Find the plugin BY ID and the track from the plugin: a client has no track index to send, and the PLUGIN's display name is not the MODULE's. docs/engineHost.md.
    auto found = impl_->session(session).pluginsById.find(id);
    if (found == impl_->session(session).pluginsById.end() || found->second == nullptr) return;
    te::Plugin* target = found->second.get();

    te::AudioTrack* track = nullptr;
    int at = -1;
    for (auto* t : te::getAudioTracks(*impl_->session(session).edit)) {
        const int i = t->pluginList.indexOf(target);
        if (i >= 0) {
            track = t;
            at = i;
            break;
        }
    }
    if (track == nullptr) return;   // in the doc but not in the graph — nothing to tap

    // "input" taps BEFORE the module, "output" AFTER it.
    const int insertIndex = (side == "input") ? at : at + 1;

    // Created via the plugin cache, where registerBuiltInPlugins put its type.
    auto tapPlugin = impl_->session(session).edit->getPluginCache().createNewPlugin(
        studio::WaveformTapPlugin::xmlTypeName, {});
    if (!tapPlugin) return;

    track->pluginList.insertPlugin(tapPlugin, insertIndex, nullptr);

    // The plugin's tap() is the ring the message thread drains; this map owns a reference keeping it alive, as does the track's pluginList.
    impl_->session(session).waveformPlugins[key] = tapPlugin;
}

void EngineHost::disableWaveformTap(const std::string& session, const std::string& id, const std::string& side) {
    const std::string key = id + ":" + side;
    auto it = impl_->session(session).waveformPlugins.find(key);
    if (it == impl_->session(session).waveformPlugins.end()) return;

    // Remove from the plugin list, dropping the plugin from the chain and releasing the reference.
    if (auto* plugin = it->second.get())
        plugin->deleteFromParent();
    impl_->session(session).waveformPlugins.erase(it);
}

std::map<std::string, std::vector<WaveformEnvelope>> EngineHost::drainAllWaveformTaps(const std::string& session) {
    std::map<std::string, std::vector<WaveformEnvelope>> result;
    auto* s = impl_->find(session);
    if (s == nullptr) return result;
    for (auto& [key, plugin] : s->waveformPlugins) {
        auto* tapPlugin = dynamic_cast<studio::WaveformTapPlugin*>(plugin.get());
        if (!tapPlugin) continue;
        auto data = tapPlugin->tap().drain();
        if (!data.empty())
            result[key] = std::move(data);
    }
    return result;
}

// --- Audio broadcast ---------------------------------------------------------

void EngineHost::enableBroadcast(const std::string& session, bool on) {
    // Turning it OFF never creates — silencing a session nobody has is already true; turning it ON does, subscribing being a client declaring it drives one.
    if (!on) {
        auto* s = impl_->find(session);
        if (s == nullptr) return;
        s->broadcastWanted = false;
        if (auto* p = s->broadcastPlugin.get()) p->deleteFromParent();
        s->broadcastPlugin = nullptr;
        return;
    }
    impl_->session(session).broadcastWanted = true;
    if (impl_->session(session).broadcastPlugin != nullptr) return;   // already tapping
    if (!impl_->session(session).edit) return;                        // reasserted by buildLevelMeters later

    // On the MASTER list, beside the level meter and after the output gain both of them follow, so a listener hears exactly what leaves for the interface.
    auto tap = impl_->session(session).edit->getPluginCache().createNewPlugin(
        studio::BroadcastTapPlugin::xmlTypeName, {});
    if (!tap) return;
    // Point it at the ring BEFORE it joins the list: once inserted an audio callback can reach it at any moment, and a plugin with no ring yet drops those blocks.
    if (auto* bt = dynamic_cast<studio::BroadcastTapPlugin*>(tap.get()))
        bt->setTap(&impl_->session(session).broadcastRing);
    // Appended: the output trim is the OUT node's own param and goes on ahead of both readers, so the tap has nothing left to stay in front of.
    impl_->session(session).edit->getMasterPluginList().insertPlugin(tap, -1, nullptr);
    impl_->session(session).broadcastPlugin = tap;
}

EngineHost::BroadcastChunk EngineHost::drainBroadcast(const std::string& session, size_t maxFrames) {
    // SENDER THREAD, so it takes the registry lock (docs/sessions.md): the ring needs none, but finding it in a map the message thread writes does.
    BroadcastChunk chunk;
    impl_->sessions.withSession(session, [&](Session& s) {
        const auto d = s.broadcastRing.drain(chunk.samples, maxFrames);
        chunk.frames = d.frames;
        chunk.lostFrames = d.lostFrames;
        chunk.sampleRate = s.broadcastRing.sampleRate();
    });
    return chunk;
}

void EngineHost::skipBroadcastToLive(const std::string& session) {
    // SENDER THREAD, like drainBroadcast above.
    impl_->sessions.withSession(session, [](Session& s) { s.broadcastRing.skipToLive(); });
}

size_t EngineHost::reapEmptySessions(double ttlMs) {
    const double now = juce::Time::getMillisecondCounterHiRes();
    size_t gone = 0;
    for (const auto& id : impl_->ids()) {
        auto* s = impl_->find(id);
        if (s == nullptr || !s->reapable(now, ttlMs)) continue;
        impl_->drop(id);
        ++gone;
    }
    if (gone > 0)
        std::cerr << "[sessions] reaped " << gone << " empty session(s)\n";
    return gone;
}

// Creating, like the other verbs a client declares with: a socket saying "I am driving X" is the moment X starts existing as far as this engine is concerned.
void EngineHost::addDriver(const std::string& session) {
    auto& s = impl_->session(session);
    ++s.drivers;
    s.noDriverSinceMs = 0.0;   // somebody is here; the clock stops
    s.lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
}

// NOT creating: a socket closing must not conjure the session it was on. find() and nothing else.
void EngineHost::removeDriver(const std::string& session) {
    auto* s = impl_->find(session);
    if (s == nullptr || s->drivers <= 0) return;
    if (--s->drivers == 0) {
        s->noDriverSinceMs = juce::Time::getMillisecondCounterHiRes();
        std::cerr << "[sessions] '" << session << "' has no driver — freeing its project in "
                  << "a moment unless one comes back\n";
    }
}

size_t EngineHost::releaseAbandonedProjects(double graceMs) {
    const double now = juce::Time::getMillisecondCounterHiRes();
    size_t freed = 0;
    for (const auto& id : impl_->ids()) {
        auto* s = impl_->find(id);
        if (s == nullptr || !s->abandoned(now, graceMs)) continue;
        // reset() and not drop(): the SESSION survives, so a tab coming back re-sends into the same slot and anything keyed on the id still means what it meant.
        reset(id);
        s->noDriverSinceMs = 0.0;   // freed once; do not report it again every sweep
        ++freed;
        std::cerr << "[sessions] '" << id << "' let go: its last driver left "
                  << (int)(graceMs / 1000.0) << "s ago\n";
    }
    return freed;
}

// --- Server support ----------------------------------------------------------

namespace {
// A message-thread timer that snapshots engine state and hands it to a callback.
class StateTimer : public juce::Timer {
public:
    StateTimer(EngineHost& h, std::function<void(const EngineHost::EngineState&)> cb)
        : host_(h), cb_(std::move(cb)) {}

    void timerCallback() override {
        // ONE FRAME PER SESSION, each carrying the id it describes, so Serve.cpp sends a session's state only to the connections driving it.
        const auto ids = host_.sessionIds();
        for (const auto& sid : ids) emit(sid);
        // Forget the idle counters of sessions that went, so the map tracks what exists.
        if (idleTicks_.size() > ids.size())
            for (auto it = idleTicks_.begin(); it != idleTicks_.end();) {
                if (std::find(ids.begin(), ids.end(), it->first) == ids.end())
                    it = idleTicks_.erase(it);
                else
                    ++it;
            }
        // The audio callback's pulse, once a second: a stalled driver otherwise freezes every transport with no error (docs/audioDevice.md).
        if (++pulseTicks_ >= kTicksPerPulse) {
            pulseTicks_ = 0;
            host_.checkAudioCallback();
        }
        // Ride this timer rather than add one: both sweeps are cheap.
        if (++ticks_ >= kTicksPerRelease) {
            ticks_ = 0;
            // Abandoned projects first, on their OWN cadence: a 45 s grace swept once a minute would take up to a minute and three quarters.
            host_.releaseAbandonedProjects(kDriverGraceMs);
            if (++releases_ >= kReleasesPerReap) {
                releases_ = 0;
                host_.reapEmptySessions(kSessionTtlMs);
            }
        }
    }

private:
    // Ten minutes untouched; dropping an EMPTY session is invisible, so the only cost of waiting is a map entry.
    static constexpr double kSessionTtlMs = 10 * 60 * 1000.0;
    /** How long a session keeps its project after its last driver went: a reload must survive it, a walk to the machine must not. See docs/sessions.md. */
    static constexpr double kDriverGraceMs = 45 * 1000.0;
    // Every five seconds at the 50 ms tick — a hundredth of the grace, so what a person sees is the grace and not the sweep.
    static constexpr int kTicksPerRelease = 100;
    static constexpr int kReleasesPerReap = 12;   // …and the empty-session sweep once a minute
    /** How many ticks an IDLE session skips before sending one anyway: five is 4 Hz, slow enough to leave a profile and quick enough to feel live. docs/protocol.md. */
    static constexpr int kIdleDivisor = 5;
    // Twenty ticks is one second: the callback watchdog's cadence (docs/audioDevice.md).
    static constexpr int kTicksPerPulse = 20;
    int pulseTicks_ = 0;
    // The floor under which a track reads as silent — the same −60 dB the surfaces call silence.
    static constexpr double kSilenceDb = -60.0;
    int ticks_ = 0;
    int releases_ = 0;
    std::map<std::string, int> idleTicks_;

    static bool allSilent(const std::vector<float>& db) {
        for (float v : db)
            if (v > kSilenceDb) return false;
        return true;
    }

    void emit(const std::string& session) {
        EngineHost::EngineState s;
        s.session = session;
        s.playing = host_.isPlaying(session);
        s.playheadSeconds = host_.playheadSeconds(session);
        const auto& doc = host_.current(session);
        s.trackLevelsDb.reserve(doc.tracks.size());
        for (int i = 0; i < (int)doc.tracks.size(); ++i)
            s.trackLevelsDb.push_back(host_.trackLevelDb(session, i));
        // Live input levels ride the same frame as the output meters, indexed like trackLevelsDb — a UI drawing an armed track's input wants both at one rate.
        s.trackInputLevelsDb = host_.inputLevelsDb(session);
        // Armed tracks ride the state frame rather than a reply of their own: arming is state, not an event, and this is the channel every surface already watches.
        s.armedTracks = host_.armedTracks(session);
        s.recordEnabled = host_.recordEnabled(session);
        // The master output rides THIS frame rather than `io-levels`: a header meter is on screen whenever the app is, the I/O panel only while it is open.
        const auto master = host_.masterState(session);
        s.masterLevelDb = master.dB;
        s.masterOverload = master.overload;

        /** Nothing is happening here, so most of these frames are not sent; the levels are in the test because an AUDITION sounds with the transport stopped. docs/engineHost.md. */
        const bool idle = !s.playing && !s.recordEnabled && s.armedTracks.empty() &&
                          // A recorder node is free-running: a rig capturing with the transport
                          // stopped looks exactly like an idle session, and skipping its drain
                          // would let the ring lap and lose the take (docs/recorder.md).
                          !host_.anyRecording(session) &&
                          !host_.sessionWatched(session) && allSilent(s.trackLevelsDb) &&
                          allSilent(s.trackInputLevelsDb);
        // Counting up to the divisor and back to zero, not modulo a counter that only grows: this runs for as long as the engine does.
        if (!idle)
            idleTicks_[session] = 0;
        else if (++idleTicks_[session] < kIdleDivisor)
            return;   // …and nothing is drained or pumped: an idle session has no tap and no watch
        else
            idleTicks_[session] = 0;

        s.waveformEnvelopes = host_.drainAllWaveformTaps(session);
        // …and the recorders, drained onto disk in the same breath: this tick IS the writer thread.
        s.recorders = host_.pumpRecorders(session);
        // A platter carries its own clock, so `playheadSeconds` says nothing about it — docs/turntable.md.
        s.platterSeconds = host_.platterPositions(session);
        cb_(s);
        // Watched params ride the same tick rather than their own timer, and after cb_, so a slow state consumer delays the params rather than the meters.
        host_.pumpPluginParamWatches(session);
    }

    EngineHost& host_;
    std::function<void(const EngineHost::EngineState&)> cb_;
};
}  // namespace

std::map<std::string, double> EngineHost::platterPositions(const std::string& session) const {
    std::map<std::string, double> out;
    // find(), never session(): a state poll must not conjure the session it is reporting on.
    const auto* s = impl_->find(session);
    if (s == nullptr) return out;
    for (const auto& [id, plugin] : s->pluginsById)
        if (auto* deck = dynamic_cast<TurntablePlugin*>(plugin.get()))
            out[id] = deck->needleSeconds();
    return out;
}

std::vector<std::string> EngineHost::sessionIds() const { return impl_->ids(); }

std::vector<EngineHost::SessionInfo> EngineHost::sessionInfos() const {
    std::vector<SessionInfo> out;
    for (const auto& id : impl_->ids()) {
        // find(), never session(): the latter CREATES, so a listing would conjure the very sessions it is meant to report on.
        const auto* s = impl_->find(id);
        if (!s) continue;
        SessionInfo info;
        info.id = id;
        // `edit` and not the doc's name: ProjectDoc defaults to "untitled", so a session that exists holding nothing would read as a project called untitled.
        info.loaded = s->edit != nullptr;
        info.project = s->current.name;
        info.trackCount = static_cast<int>(s->current.tracks.size());
        info.playing = isPlaying(id);
        out.push_back(std::move(info));
    }
    return out;
}

void EngineHost::dropSession(const std::string& session) {
    // Tear the project down FIRST, then forget the slot: dropping the map entry alone would free an Edit the audio thread is still inside.
    reset(session);
    impl_->drop(session);
}

void EngineHost::post(std::function<void()> fn) {
    // callAsync queues onto the JUCE message thread; safe from any thread.
    juce::MessageManager::callAsync(std::move(fn));
}

void EngineHost::onState(std::function<void(const EngineState&)> cb, int intervalMs) {
    auto timer = std::make_unique<StateTimer>(*this, std::move(cb));
    timer->startTimer(intervalMs);            // must be started on the message thread
    impl_->stateTimer = std::move(timer);
}

#if JUCE_ANDROID
namespace {
// Call a method of android.os.Looper: static `loop` when `self` is false, else `method` on this thread's own Looper.
void callLooper(const char* method, bool self) {
    auto* env = juce::getEnv();
    const jclass cls = env->FindClass("android/os/Looper");
    if (!self) {
        env->CallStaticVoidMethod(cls, env->GetStaticMethodID(cls, method, "()V"));
    } else if (const jobject mine = env->CallStaticObjectMethod(
                   cls, env->GetStaticMethodID(cls, "myLooper", "()Landroid/os/Looper;"))) {
        env->CallVoidMethod(mine, env->GetMethodID(cls, method, "()V"));
        env->DeleteLocalRef(mine);
    }
    env->DeleteLocalRef(cls);
}
}  // namespace
#endif

void EngineHost::run() {
#if JUCE_ANDROID
    // The message loop IS this thread's Looper — JUCE's Handler bound to it — so loop it until quit(). docs/android.md.
    callLooper("loop", false);
#else
    // NOT runDispatchLoop(): on macOS that is `[NSApp run]`, and NSApp is nil here, so it returns instantly and the engine would exit ~0.3s after binding. docs/design.md.
    while (pumpMessages(100)) {
    }
#endif
}

void EngineHost::quit() {
#if JUCE_ANDROID
    // Quit the Looper run() spins, from ITS thread: stopDispatchLoop on Android finishes the app's Activity instead.
    juce::MessageManager::callAsync([] { callLooper("quitSafely", true); });
#else
    juce::MessageManager::getInstance()->stopDispatchLoop();
#endif
}

}  // namespace studio
