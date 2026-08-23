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
#include "Warnings.h"          // WarningScope — which project an apply's warnings belong to

#include <algorithm>
#include <iostream>
#include <map>
#include <utility>
#include <vector>

namespace studio {

// API NOTE — pinned to Tracktion Engine v3.2.0 (see CMakeLists.txt). Model types are tracktion::engine (te),
// but the core time types (TimePosition/TimeDuration/TimeRange/BeatPosition) are tracktion (tt), NOT under
// engine. If you bump the tag and it stops compiling, the calls in this file are the ones to check —
// everything else in the project is engine-agnostic.

EngineHost::EngineHost() : impl_(std::make_unique<Impl>()) {
    // The audio device is deliberately NOT opened here (see openAudioDevice): constructing the host is cheap, so
    // main() can bind the WebSocket port before paying the sometimes multi-second device-open cost.

    // Our built-ins + the two Tracktion ships unregistered. Shared with the offline paths, which need
    // exactly the same set — see registerBuiltInPlugins.
    registerBuiltInPlugins(impl_->engine);
}

const ProjectDoc& EngineHost::current(const std::string& session) const {
    // A session nobody has sent a project to holds the empty doc — asking about one must not make it.
    static const ProjectDoc kEmpty{};
    auto* s = impl_->find(session);
    return s ? s->current : kEmpty;
}

void EngineHost::openAudioDevice() {
    // Open the interface once — it stays open for the engine's lifetime. Playback is silent without it, which is
    // the thing headless apps most often forget.
    //
    // INPUTS are opened too, and that is not decoration: with zero input channels open the audio callback delivers
    // no input samples at all, so no WaveInputDevice ever sees one. Every input then meters exactly -100 for ever
    // while its device still reports itself enabled — which is what an interface with nothing plugged in looks
    // like, so nothing anywhere reports a fault. It used to open `(0, 2)`; the only reason recording appeared to
    // work is that switching device by hand goes through setAudioDevice(), which sets useDefaultInputChannels.
    // 512 is Tracktion's own default, and means "as many as the device has".
    auto& dm = impl_->engine.getDeviceManager();
    dm.initialise(512, 2);
    // …then onto the buffer this engine asks for, which is what decides its quality band — see
    // applyPreferredBufferSize. After initialise, because there is no device to ask before it.
    applyPreferredBufferSize(dm.deviceManager);
    publishAudioTiming();   // what whoami answers with, from now on — see AudioDevices.cpp
    if (auto* dev = dm.deviceManager.getCurrentAudioDevice())
        std::cerr << "[device] '" << dev->getName() << "' open: "
                  << dev->getActiveInputChannels().countNumberOfSetBits() << " in, "
                  << dev->getActiveOutputChannels().countNumberOfSetBits() << " out\n";
}

EngineHost::~EngineHost() {
    if (impl_) {
        // The tuner FIRST: it is a live audio callback, so it must stop being called before anything it reads
        // through goes away. Only ever attached if something asked for a pitch.
        if (impl_->tunerAttached)
            impl_->engine.getDeviceManager().deviceManager.removeAudioCallback(&impl_->tuner);
        // EVERY session, because the destructor is nobody's session in particular. Take
        // each broadcast tap off its master list and unregister its meter clients before
        // anything they touch goes away — a tap that is gone cannot write into anything.
        for (const auto& id : impl_->ids()) {
            enableBroadcast(id, false);
            if (auto* s = impl_->find(id)) s->detachLevelMeters();
        }
        impl_->detachInputClients();   // and input clients before the devices (their measurers) do
    }
}

void EngineHost::teardownProjectState(const std::string& session) {
    // Close plugin editors and drop plugin refs BEFORE the old edit is destroyed: the windows own editors pointing
    // at those plugins.
    impl_->session(session).pluginWindows.clear();
    impl_->session(session).pluginsById.clear();
    impl_->session(session).presetSaveById.clear();
    impl_->session(session).lastSavedState.clear();
    impl_->session(session).detachLevelMeters();   // unregister clients before their measurers die
    impl_->session(session).waveformPlugins.clear();  // release taps before the edit dies
    // The broadcast PLUGIN goes with them; the ring does not, being EngineHost's. And
    // `broadcastWanted` stays, so buildLevelMeters puts a fresh tap on the new edit and a
    // listener survives an apply.
    impl_->session(session).broadcastPlugin = nullptr;
    // The transport dies with the edit, so drop the listener while there is still something to drop it from.
    if (impl_->session(session).recordListener)
        if (auto* tc = impl_->transport(session))
            tc->removeListener(impl_->session(session).recordListener.get());
    impl_->session(session).pendingTakes.clear();
    // Keep the WATCHES — a client's interest in an id outlives the plugin behind it — but drop their baselines:
    // the values just torn down belonged to the old instance, and diffing against them would hide any parameter
    // that came back different.
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
    // Building a graph is where nearly every warning comes from — a missing plugin, a clip that will
    // not load — so name the project they are about for as long as the build runs.
    WarningScope ws{session};
    impl_->session(session).lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
    teardownProjectState(session);
    invalidatePluginInfoMemo();   // reload the scan cache once per apply (picking up a rescan), then memoise
                                  // it across this apply's per-plugin lookups

    // Time the phases: this is the work the first play waits on — the edit graph, every plugin instantiated,
    // the playback context allocated — printed once per apply, so a slow first play is diagnosable from the log.
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
    // A fresh Edit starts with no click, so re-assert the metronome flag, or every apply would silence it.
    applyMetronome(session);
    const double t3 = juce::Time::getMillisecondCounterHiRes();

    // EVERY graph-invalidating call is above this line, and that ordering is the whole point.
    // `insertPlugin` reaches Edit::restartPlayback(), which rebuilds the entire graph 1 ms later on
    // this same thread — so allocating the context first, then adding meters and a click, built it
    // twice: once here and once after applyFull had already returned and answered `busy:false`.
    // The second build landed on whichever message-loop turn came next, which in practice was the
    // one carrying the user's first `play`. That was the freeze. See docs/audit-stabilite.md.
    tc->ensureContextAllocated();
    const double t4 = juce::Time::getMillisecondCounterHiRes();

    impl_->session(session).current = doc;
    // The song's output level, on the gain buildLevelMeters just put on the master list after the
    // song's own chain. Here rather than there because HERE is where `doc` is the truth — see its note.
    if (auto* mg = dynamic_cast<studio::MasterGainPlugin*>(
            impl_->session(session).masterGain.get()))
        mg->setGainDb(doc.masterVolume);
    impl_->session(session).baseDir = baseDir;
    // Live inputs need the context ensureContextAllocated() just made, and map ids through `current`.
    applyAllTrackInputs(session, doc);

    // Re-attach the record listener to this edit's transport — the previous edit's is gone with its listener list.
    // Defined in Recording.cpp, where the RecordListener type is complete.
    attachRecordListener(session);

    // Drain whatever the input pass still queued, HERE, where it is timed and where it happens before
    // anyone is told the project is ready — rather than on Edit's 1 ms timer, on top of the next message.
    const double t5 = juce::Time::getMillisecondCounterHiRes();
    edit->dispatchPendingUpdatesSynchronously();
    const double t6 = juce::Time::getMillisecondCounterHiRes();

    std::cerr << "[applyFull] createEdit=" << (t1 - t0) << "ms populate=" << (t2 - t1)
              << "ms meters+click=" << (t3 - t2) << "ms ensureContext=" << (t4 - t3)
              << "ms inputs=" << (t5 - t4) << "ms settle=" << (t6 - t5)
              << "ms total=" << (t6 - t0) << "ms plugins=" << impl_->session(session).pluginsById.size() << "\n";
}

// Append a post-fader LevelMeterPlugin to every audio track and attach the client we poll for VU. Called after
// a full rebuild; the incremental path leaves existing meters alone, since a track param edit can't disturb them.
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

    /**
     * The song's OUTPUT LEVEL — the OUT node's `Volume`, and so the LAST thing in the song.
     *
     * FOUND, not made: `populateEdit` put it there, right behind the master chain, because the
     * offline render runs that and nothing of this file (see populateMasterChain). Held here so
     * `MasterVolumeChanged` has something to set without walking the list again.
     *
     * Everything below goes on AFTER it — the meter, then the broadcast tap — which is the graph's
     * own order: `MIX -> [chain] -> OUT`, then the engine observing what leaves, which is the
     * point of observing it.
     *
     * It sat LAST, after both, while the fader and the Fix button were separate controls: the
     * meter answered for the mix and the trim was a delivery decision on top of it. They are one
     * control now — Fix writes this very param — and a Fix the meter could not see would leave the
     * clip light lit and offer itself again on the next pass, taking another 6 dB each time. So
     * the order follows the graph, and the two costs of that are stated rather than hidden:
     * raising the output raises the bar, and a listener on the broadcast hears the level this room
     * is set to. See packages/song/docs/masterVolume.md.
     */
    impl_->session(session).masterGain = studio::masterGainOf(*impl_->session(session).edit);

    // …and one meter on the master list, after that gain, which is where the mix leaves for the
    // interface. An output DEVICE carries no measurer in Tracktion, so this plugin is the only
    // place the outgoing level can be read at all.
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

    // The broadcast tap goes back on the same list. A rebuild threw away the old edit and
    // every plugin on it, so the WISH is what survived — without this, saving a file
    // silences every listener, which is not a fault anyone would trace back to a save.
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

/**
 * The master output as the 20 Hz frame reports it: its peak since the last frame, and whether that
 * peak went over full scale.
 *
 * Read through the state frame's own client (see EngineHostImpl), so asking here does not empty
 * the meter `io-levels` reads.
 *
 * The overload is DEDUCED from that peak, and it is exact rather than a guess, because the peak
 * itself latches: `updateAudioLevel` keeps the running MAXIMUM since the last read, so one frame's
 * dB is the loudest sample of the whole 50 ms window and not a 20 Hz sample of a waveform. A clip
 * is one sample over full scale; if there was one, it IS this number.
 *
 * Not `Client::getAndClearOverload()`, which is named for a question it does not answer: it returns
 * `clearOverload`, the flag a meter WIDGET is handed to be told "you were asked to reset" — true
 * once at construction, then false for good. Tracktion keeps the real per-channel `overload[]`
 * private with no getter, which is why the level is the way in.
 */
EngineHost::MasterLevel EngineHost::masterState(const std::string& session) const {
    auto* s = impl_->find(session);
    if (s == nullptr || !s->masterStateClient) return {-100.0f, false};
    auto& client = *s->masterStateClient;
    // Both read unconditionally: reading CLEARS, so skipping one would carry its peak into the
    // next frame and report a clip one window late.
    const float l = client.getAndClearAudioLevel(0).dB;
    const float r = client.getAndClearAudioLevel(1).dB;
    const float peak = std::max(l, r);
    // 0 dB, which is Tracktion's own threshold: processBuffer overloads a channel above 0.999.
    return {peak, peak > 0.0f};
}

// Drop the clip a ClipDoc names. Clips carry their PLACEMENT id as the Tracktion clip name, so that is
// what identifies one — `clipNameFor` is the single spelling of that, and the three sites drifting from
// each other is what let a pasted event remove its own original (EditBuilder, docs/clipIdentity.md).
// Iterating a COPY is deliberate, since removeFromParent() mutates the live list.
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
            // In place, and that is the point of it having a change at all: a master move while the
            // song plays must not stop the song, which a full rebuild would (it replaces the Edit,
            // and the transport with it).
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
                // Re-INSERT, not reposition: start, length, source, offset, source window, loop and warp are all
                // applied at insert time and nowhere else, so setStart/setLength would drop everything but two.
                // This was an empty stub, and the diff reported "moved" the whole time — see docs/engineHost.md.
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.clip) {
                    removeClipFor(*t, *c.clip);
                    if (c.clip->type == ClipType::Midi) insertMidiClip(edit, *t, *c.clip);
                    else insertClip(engine, edit, *t, *c.clip, baseDir);
                }
                break;
            /**
             * The one new plugin, into the LIVE track — what used to cost a whole rebuild.
             *
             * Measured before this existed: adding one module to a 32-plugin song spent 4026 ms of a 4169 ms
             * apply re-instantiating the 31 that had not changed, with the transport dead for all of it.
             *
             * The position is read off the LIVE plugin list rather than from the document's own index, because
             * the two do not agree: a waveform tap is a plugin in this same list (watchWaveform inserts one
             * beside the module it watches), so a document index would land in the wrong place the moment a
             * waveform widget is open. We find the doc plugin that PRECEDES this one and insert after it.
             *
             * Anything that does not hold falls back to the rebuild it replaced. That is the same trade the
             * rule in needsFullRebuild states — this path has to be exactly right or not taken.
             */
            case ChangeKind::PluginAdded: {
                const auto rebuild = [&] { applyFull(session, target, baseDir); };
                auto* t = trackById(edit, c.trackId, impl_->session(session).current);
                const TrackDoc* td = nullptr;
                for (const auto& x : target.tracks)
                    if (x.id == c.trackId) { td = &x; break; }
                if (t == nullptr || td == nullptr || !c.plugin) { rebuild(); return d; }

                // A tap sits between the modules and would make "after the previous one" ambiguous — it is the
                // output of one module and the input of the next. Rare (only while a waveform widget is open)
                // and not worth guessing at, so the rebuild takes it.
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
                // Null means it could not be instantiated — a missing VST, already warned by addPlugin. A
                // rebuild would fail identically, so leave the rest of the song playing.
                if (pl == nullptr) break;
                impl_->session(session).pluginsById[c.plugin->id] = pl;
                if (!c.plugin->presetSave.empty())
                    impl_->session(session).presetSaveById[c.plugin->id] = c.plugin->presetSave;
                break;
            }

            // --- Skeletons: structurally located, engine call TODO ------------
            // Each of these has a clear home; they are left explicit rather than faked, so the compiler keeps reminding us.
            // A stub here is NOT free: the diff still reports the change, so the log says it was applied while nothing
            // moved. ClipMoved sat here for as long as it took a tempo fader to be built on top of it.
            case ChangeKind::TrackRemoved:
                // te::deleteRegionOfTracks / edit.deleteTrack(*t) — needs the Track (not just AudioTrack) and an undo transaction.
                break;
            /**
             * Take the one plugin out of the LIVE chain, which is what unlinking a module is.
             *
             * This rebuilt the whole Edit until now, and a rebuild replaces the Edit — so it replaces the
             * TRANSPORT with it, and playback stops. That is the entire bug report: "unlinking an instance stops
             * playback". Removing it in place leaves everything else, including what is rolling, untouched.
             *
             * `deleteFromParent` on a plugin in a playing chain is not new here — disableWaveformTap has always
             * pulled its tap out that way.
             */
            case ChangeKind::PluginRemoved: {
                if (!c.plugin) break;
                auto& s = impl_->session(session);
                auto it = s.pluginsById.find(c.plugin->id);
                // Absent from the graph: it never instantiated (a missing VST warns at load). Nothing to remove,
                // and a rebuild would produce the same nothing more slowly.
                if (it == s.pluginsById.end() || it->second == nullptr) {
                    s.pluginsById.erase(c.plugin->id);
                    break;
                }
                // Its own waveform taps go WITH it: they sit either side of this plugin in the list, and left
                // behind they would measure its neighbours while claiming to be its input and output.
                for (const char* side : {"input", "output"})
                    disableWaveformTap(session, c.plugin->id, side);
                // The editor window points at the plugin, so it closes first — the same order teardownProjectState
                // observes for exactly this reason.
                s.pluginWindows.erase(c.plugin->id);
                it->second->deleteFromParent();
                s.pluginsById.erase(it);
                s.presetSaveById.erase(c.plugin->id);
                s.lastSavedState.erase(c.plugin->id);
                // watchedParams is deliberately NOT cleared: a client's interest in an id outlives the plugin
                // behind it, exactly as it does across a rebuild.
                break;
            }
            case ChangeKind::PluginParamChanged:
                // diff() emits one of these per differing parameter, keyed by the same display name applyPluginParams() and
                // namedParams() use, so the value round-trips by name. An id absent from the running edit means the plugin
                // failed to instantiate — a missing VST warns at load, so skip rather than warn again per param.
                if (c.plugin)
                    if (auto it = impl_->session(session).pluginsById.find(c.plugin->id);
                        it != impl_->session(session).pluginsById.end() && it->second != nullptr)
                        applyPluginParams(*it->second, {{c.paramName, c.paramValue}});
                break;
            case ChangeKind::PluginEnabledChanged:
                // Bypass on the LIVE plugin: it stays in the chain and passes its input through. Same lookup as a param change,
                // and deliberately not a rebuild — toggling bypass should not restart every other plugin.
                if (c.plugin)
                    if (auto it = impl_->session(session).pluginsById.find(c.plugin->id);
                        it != impl_->session(session).pluginsById.end() && it->second != nullptr)
                        it->second->setEnabled(c.enabled);
                break;
            case ChangeKind::AutomationChanged:
                // Re-bake the lane onto its target plugin's parameter curve, keyed by the plugin id it carries; one absent from
                // the running edit is skipped, like a param change.
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

    // Re-assert the click from the updated doc. The metronome flag is not a tracked ChangeKind, so a toggle arrives
    // as an otherwise-empty diff — applied unconditionally here, as solo and mute are above.
    applyMetronome(session);

    // Inputs go last, once `impl_->session(session).current` is the new baseline: applyTrackInput maps a track id to its lane THROUGH
    // impl_->session(session).current, and a track this diff added exists only in `target` — inside the loop it would find nothing.
    for (const auto& c : d)
        if (c.kind == ChangeKind::TrackInputChanged && c.track)
            applyTrackInput(session, *c.track);
    return d;
}

// The project's count-in in bars, mapped to Tracktion's CountIn mode, whose enum caps at two — enough for the
// usual count, and 0 means none. During one Tracktion rolls that many bars before capture AND sets a click
// range, so the count is audible even with the metronome otherwise off.
static te::Edit::CountIn countInModeFor(int bars) {
    if (bars <= 0) return te::Edit::CountIn::none;
    if (bars == 1) return te::Edit::CountIn::oneBar;
    return te::Edit::CountIn::twoBar;
}

// Play — and record the armed tracks if THIS SESSION's enable is on. Arming only marks a track as wanting to
// record, so a user can leave tracks armed and audition without recording.
void EngineHost::play(const std::string& session) {
    auto* tc = impl_->transport(session);
    if (tc == nullptr) return;

    // `setCountInMode` LOOKS like an Edit property and is not one: Tracktion implements it as
    // engine.getPropertyStorage().setProperty(SettingID::countInMode, …) — process-global, and flushed
    // to the %APPDATA%/Studio/Settings.xml this engine otherwise treats as inert (AGENTS.md). Calling it
    // on every play therefore rewrote that file every time anyone pressed play. Both branches below still
    // assert the mode they need, so the behaviour is unchanged; only the redundant writes are gone.
    //
    // It being engine-global also means two sessions share ONE count-in. That is survivable exactly
    // because each play sets it, and it is why this must not be hoisted out of the transport calls.
    const auto setCountIn = [this, &session](te::Edit::CountIn mode) {
        auto* edit = impl_->session(session).edit.get();
        if (edit == nullptr || impl_->countInApplied == (int)mode) return;
        edit->setCountInMode(mode);
        impl_->countInApplied = (int)mode;
    };

    // A loop always starts from its top, so drop the playhead onto the start; Tracktion wraps back on its own.
    if (tc->looping) tc->setPosition(tc->getLoopRange().getStart());
    if (impl_->session(session).recordEnabled && prepareTakes(session)) {
        // Count-in applies to the record roll only: set it from the project just before recording and clear it on a
        // plain play, so an earlier record's count-in can't linger onto ordinary playback.
        setCountIn(countInModeFor(impl_->session(session).current.countIn));
        tc->record(false);
    } else {
        setCountIn(te::Edit::CountIn::none);
        tc->play(false);
    }
}
// Creating, unlike the readers around it: a client saying "rolling me records" is declaring it drives
// this project, the same way subscribing to its audio is.
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

// Project the doc's metronome flag onto the Edit's click track, reading impl_->session(session).current — the single source of truth,
// which every apply path sets first. Emphasise-bars stays on always: the bar's first beat sounding different
// IS the feature, not a separate toggle.
void EngineHost::applyMetronome(const std::string& session) {
    if (!impl_->session(session).edit) return;
    impl_->session(session).edit->clickTrackEnabled = impl_->session(session).current.metronome;
    impl_->session(session).edit->clickTrackEmphasiseBars = true;
    // The level, through Tracktion's setter rather than the value directly: it clamps to 0.2..1 and
    // remembers the choice in the engine's own property storage, which is what makes a new Edit in
    // this process start where the last one left off. The document is still the source of truth —
    // this runs on every apply, so a project that states a level always wins over that memory.
    impl_->session(session).edit->setClickTrackVolume(
        (float) impl_->session(session).current.metronomeLevel);
}
void EngineHost::stop(const std::string& session) { if (auto* tc = impl_->transport(session)) tc->stop(false, false); }
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

// Find, or lazily create, the hidden sampler that auditions the editor's play buttons. It rides as an extra
// track at the END of the edit — outside the doc, so the timeline and graph never show it and doc indices are
// unshifted. applyFull drops it with the old edit; we recreate it on demand.
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
    // SamplerPlugin opens its source through a SourceFileReference, which resolves an absolute path only with this
    // resolver in place. Already set on a built edit; set again defensively.
    edit.filePathResolver = [](const juce::String& s) { return juce::File(s); };
    auto* sampler = ensurePreviewSampler(edit);
    if (sampler == nullptr) return;
    sampler->allNotesOff();
    for (int i = sampler->getNumSounds(); --i >= 0;) sampler->removeSound(i);
    if (! addRackSound(edit, *sampler, file, "preview", kPreviewNote, startSeconds,
                       lengthSeconds))
        return;
    // addSound loads asynchronously and playNotes only sounds once that data is in, so fire the note on the NEXT
    // message-thread turn, by which time the load has run. A ref-counted handle keeps the plugin alive if the edit
    // is torn down meanwhile — the note then plays into nothing, harmlessly.
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

float EngineHost::trackLevelDb(const std::string& session, int trackIndex) const {
    // Peak dB since the last poll, from the track's LevelMeterPlugin client. Reading clears the accumulator, so
    // each poll gives a fresh peak — exactly what a VU meter wants. -100 dB when there is no meter yet.
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

    // Find the plugin BY ID, and the track from the plugin — rather than trusting a track
    // index from the client and then matching on the plugin's display name.
    //
    // Both halves of that were wrong. The graph has no track index to send (a chain can be
    // a bus with no track of its own), and the name compared was the PLUGIN's — "Neural Amp
    // Modeler" — against the MODULE's — "neural-amp-modeler" — so the target was never
    // found and the tap silently went to the end of the chain, metering the track output
    // instead of the module. pluginsById is keyed by exactly the id the client sends.
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

    // The plugin's tap() is the ring buffer the message thread drains; this map owns a
    // reference (keeping it alive), as does the track's pluginList.
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
    // Turning it OFF never creates: silencing a session nobody has is already true. Turning it
    // ON does, because subscribing to a session's audio is a client declaring it drives one.
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

    // On the MASTER list, so it hears the mix after everything — exactly like the master level
    // meter it sits beside, and after the output gain both of them now follow. A listener hears
    // what leaves for the interface, which is what a render and a share carry too.
    auto tap = impl_->session(session).edit->getPluginCache().createNewPlugin(
        studio::BroadcastTapPlugin::xmlTypeName, {});
    if (!tap) return;
    // Point it at the ring BEFORE it joins the list: once inserted, an audio callback can
    // reach it at any moment, and a plugin with no ring yet would drop those blocks.
    if (auto* bt = dynamic_cast<studio::BroadcastTapPlugin*>(tap.get()))
        bt->setTap(&impl_->session(session).broadcastRing);
    // Appended. It used to insert AT the gain to stay upstream of it, back when the output trim
    // was the last thing on the list; the trim is the OUT node's own param now and goes on ahead
    // of both readers (buildLevelMeters), so there is nothing left to stay in front of.
    impl_->session(session).edit->getMasterPluginList().insertPlugin(tap, -1, nullptr);
    impl_->session(session).broadcastPlugin = tap;
}

EngineHost::BroadcastChunk EngineHost::drainBroadcast(const std::string& session, size_t maxFrames) {
    // SENDER THREAD, so it goes through the registry lock — see docs/sessions.md. The ring itself
    // needs none (it outlives every edit); finding it in a map the message thread writes does.
    // No session yet means no frames, which the caller already treats as "nothing to send".
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

// Creating, like the other verbs a client uses to declare it drives this project: a socket saying
// "I am driving X" is the moment X starts existing as far as this engine is concerned.
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
        // reset() and not drop(): the SESSION survives. A tab that comes back re-sends its
        // document into the same slot, and anything still keyed on the id — a watch, a
        // subscription — keeps meaning what it meant.
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
        // ONE FRAME PER SESSION. Each carries the id it describes, so main.cpp can send a
        // session's state only to the connections driving it — a listener that got
        // everybody's meters would draw somebody else's song.
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
        // Ride this timer rather than add one: both sweeps are cheap.
        if (++ticks_ >= kTicksPerRelease) {
            ticks_ = 0;
            // Abandoned projects first, and on their OWN cadence: a grace of 45 s swept once a
            // minute would take up to a minute and three quarters, and the whole point is that
            // closing a tab frees the machine promptly.
            host_.releaseAbandonedProjects(kDriverGraceMs);
            if (++releases_ >= kReleasesPerReap) {
                releases_ = 0;
                host_.reapEmptySessions(kSessionTtlMs);
            }
        }
    }

private:
    // Ten minutes untouched, and dropping an EMPTY session is invisible, so the only cost of
    // waiting is a map entry.
    static constexpr double kSessionTtlMs = 10 * 60 * 1000.0;
    /**
     * How long a session keeps its project after its last driver went.
     *
     * Long enough to survive a reload, a redraw and a flaky minute of Wi-Fi; short enough that
     * closing a tab and walking to the machine finds it free. Those are the two failures being
     * traded, and neither is a corner case: a refcount with no grace at all was rejected in
     * docs/sessions.md precisely because it took a loaded project away on every tab reload.
     */
    static constexpr double kDriverGraceMs = 45 * 1000.0;
    // Every five seconds at the 50 ms tick — a hundredth of the grace, so what a person sees is
    // the grace and not the sweep.
    static constexpr int kTicksPerRelease = 100;
    static constexpr int kReleasesPerReap = 12;   // …and the empty-session sweep once a minute
    /**
     * How many ticks an IDLE session skips before it sends one anyway.
     *
     * A frame went out every 50 ms whether or not anything was happening, and a browser paid for
     * all of it: parse, then every subscriber's selector, twenty times a second, to conclude that
     * a stopped transport over silent tracks still says nothing. Five ticks is 4 Hz — slow enough
     * to disappear from a profile, quick enough that a change made from another tab still shows
     * up before anyone reaches for the mouse. See docs/protocol.md.
     */
    static constexpr int kIdleDivisor = 5;
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
        // Live input levels ride the same frame as the output meters — a UI drawing an armed track's input wants both
        // at one rate. A single pass, indexed like trackLevelsDb.
        s.trackInputLevelsDb = host_.inputLevelsDb(session);
        // Armed tracks ride the state frame rather than a reply of their own: arming is state, not an event, and this
        // is the channel every surface already watches, so a tab connecting mid-session sees it without asking.
        s.armedTracks = host_.armedTracks(session);
        s.recordEnabled = host_.recordEnabled(session);
        // The master output — one number for the whole mix, plus whether it overloaded since the
        // last frame. Both ride THIS frame rather than `io-levels`, because a header meter is on
        // screen whenever the app is and `io-levels` is asked for only while the I/O panel is open.
        const auto master = host_.masterState(session);
        s.masterLevelDb = master.dB;
        s.masterOverload = master.overload;

        /**
         * Nothing is happening in this session, so most of these frames are not sent.
         *
         * Everything above is cheap to read; what costs is what comes after — serialising the
         * frame, pushing it down every socket, and then a browser parsing it and running every
         * subscriber's selector over it. That was paid twenty times a second for a stopped
         * transport over silent tracks. The levels are in the test because an AUDITION sounds
         * without the transport rolling, and a monitored input moves a meter while it does.
         */
        const bool idle = !s.playing && !s.recordEnabled && s.armedTracks.empty() &&
                          !host_.sessionWatched(session) && allSilent(s.trackLevelsDb) &&
                          allSilent(s.trackInputLevelsDb);
        // Counting up to the divisor and back to zero, not modulo a counter that only grows:
        // this runs for as long as the engine does.
        if (!idle)
            idleTicks_[session] = 0;
        else if (++idleTicks_[session] < kIdleDivisor)
            return;   // …and nothing is drained or pumped: an idle session has no tap and no watch
        else
            idleTicks_[session] = 0;

        s.waveformEnvelopes = host_.drainAllWaveformTaps(session);
        cb_(s);
        // Watched params ride the same tick rather than their own timer: both are "what is the engine holding", and one
        // timer means a param can never report faster than the meters already sustain. It runs after cb_, so a slow
        // state consumer delays the params rather than the meters.
        host_.pumpPluginParamWatches(session);
    }

    EngineHost& host_;
    std::function<void(const EngineHost::EngineState&)> cb_;
};
}  // namespace

std::vector<std::string> EngineHost::sessionIds() const { return impl_->ids(); }

std::vector<EngineHost::SessionInfo> EngineHost::sessionInfos() const {
    std::vector<SessionInfo> out;
    for (const auto& id : impl_->ids()) {
        // find(), never session(): the latter CREATES, so a listing would conjure the very
        // sessions it is meant to report on.
        const auto* s = impl_->find(id);
        if (!s) continue;
        SessionInfo info;
        info.id = id;
        // `edit` and not the doc's name: ProjectDoc defaults to "untitled", so a session
        // that exists holding nothing would otherwise read as a project called untitled.
        info.loaded = s->edit != nullptr;
        info.project = s->current.name;
        info.trackCount = static_cast<int>(s->current.tracks.size());
        info.playing = isPlaying(id);
        out.push_back(std::move(info));
    }
    return out;
}

void EngineHost::dropSession(const std::string& session) {
    // Tear the project down FIRST, then forget the slot: reset() unregisters meter clients
    // and takes the taps off, and dropping the map entry alone would free an Edit the audio
    // thread is still inside.
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

void EngineHost::run() {
    // Block the calling thread, dispatching message-thread work until quit() stops it. NOT runDispatchLoop(): on
    // macOS that is `[NSApp run]`, and NSApp only exists when JUCEApplicationBase::main() created it — we have our
    // own main() and only a ScopedJuceInitialiser_GUI, so NSApp is nil, `[nil run]` returns instantly, and the
    // engine would exit ~0.3s after binding its port. runDispatchLoopUntil() drives CFRunLoopRunInMode directly.
    while (juce::MessageManager::getInstance()->runDispatchLoopUntil(100)) {
    }
}

void EngineHost::quit() {
    juce::MessageManager::getInstance()->stopDispatchLoop();
}

}  // namespace studio
