#include "EngineHost.h"

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
    const double t1 = juce::Time::getMillisecondCounterHiRes();
    populateEdit(impl_->engine, *impl_->session(session).edit, doc, baseDir, &impl_->session(session).pluginsById, &impl_->session(session).presetSaveById);
    const double t2 = juce::Time::getMillisecondCounterHiRes();
    impl_->transport(session)->ensureContextAllocated();
    const double t3 = juce::Time::getMillisecondCounterHiRes();
    buildLevelMeters(session);           // append a metering plugin + client to each track
    const double t4 = juce::Time::getMillisecondCounterHiRes();
    std::cerr << "[applyFull] createEdit=" << (t1 - t0) << "ms populate=" << (t2 - t1)
              << "ms ensureContext=" << (t3 - t2) << "ms meters=" << (t4 - t3)
              << "ms total=" << (t4 - t0) << "ms plugins=" << impl_->session(session).pluginsById.size() << "\n";
    impl_->session(session).current = doc;
    impl_->session(session).baseDir = baseDir;
    // Live inputs last: they need the context ensureContextAllocated() just made, and map ids through `impl_->session(session).current`.
    applyAllTrackInputs(session, doc);

    // Re-attach the record listener to this edit's transport — the previous edit's is gone with its listener list.
    // Defined in Recording.cpp, where the RecordListener type is complete.
    attachRecordListener(session);

    // A fresh Edit starts with no click, so re-assert the metronome flag, or every apply would silence it.
    applyMetronome(session);
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

    // …and one on the master list, which is where the mix leaves for the interface. An output DEVICE carries no
    // measurer in Tracktion, so this plugin is the only place the outgoing level can be read at all.
    auto master = impl_->session(session).edit->getPluginCache().createNewPlugin(te::LevelMeterPlugin::xmlTypeName, {});
    if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(master.get())) {
        impl_->session(session).edit->getMasterPluginList().insertPlugin(master, -1, nullptr);
        impl_->session(session).masterClient = std::make_unique<te::LevelMeasurer::Client>();
        lm->measurer.addClient(*impl_->session(session).masterClient);
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

// Drop the clip a ClipDoc names. Clips carry their doc id as the Tracktion clip name, so that is what
// identifies one; iterating a COPY is deliberate, since removeFromParent() mutates the live list.
static void removeClipFor(te::AudioTrack& t, const ClipDoc& c) {
    const juce::String name = juce::String(c.name.empty() ? c.id : c.name);
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
            case ChangeKind::PluginAdded:
                if (auto* t = trackById(edit, c.trackId, impl_->session(session).current); t && c.plugin)
                    addPlugin(edit, *t, *c.plugin, 0);   // incremental add at the front
                break;

            // --- Skeletons: structurally located, engine call TODO ------------
            // Each of these has a clear home; they are left explicit rather than faked, so the compiler keeps reminding us.
            // A stub here is NOT free: the diff still reports the change, so the log says it was applied while nothing
            // moved. ClipMoved sat here for as long as it took a tempo fader to be built on top of it.
            case ChangeKind::TrackRemoved:
                // te::deleteRegionOfTracks / edit.deleteTrack(*t) — needs the Track (not just AudioTrack) and an undo transaction.
                break;
            case ChangeKind::PluginRemoved:
                // plugin->deleteFromParent();
                break;
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
    // A loop always starts from its top, so drop the playhead onto the start; Tracktion wraps back on its own.
    if (tc->looping) tc->setPosition(tc->getLoopRange().getStart());
    if (impl_->session(session).recordEnabled && prepareTakes(session)) {
        // Count-in applies to the record roll only: set it from the project just before recording and clear it on a
        // plain play, so an earlier record's count-in can't linger onto ordinary playback.
        if (impl_->session(session).edit) impl_->session(session).edit->setCountInMode(countInModeFor(impl_->session(session).current.countIn));
        tc->record(false);
    } else {
        if (impl_->session(session).edit) impl_->session(session).edit->setCountInMode(te::Edit::CountIn::none);
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

// Project the doc's metronome flag onto the Edit's click track, reading impl_->session(session).current — the single source of truth,
// which every apply path sets first. Emphasise-bars stays on always: the bar's first beat sounding different
// IS the feature, not a separate toggle.
void EngineHost::applyMetronome(const std::string& session) {
    if (!impl_->session(session).edit) return;
    impl_->session(session).edit->clickTrackEnabled = impl_->session(session).current.metronome;
    impl_->session(session).edit->clickTrackEmphasiseBars = true;
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

std::vector<WaveformEnvelope> EngineHost::waveformData(const std::string& session,
                                                       const std::string& id,
                                                       const std::string& side) {
    auto* s = impl_->find(session);
    if (s == nullptr) return {};
    const std::string key = id + ":" + side;
    auto it = s->waveformPlugins.find(key);
    if (it == s->waveformPlugins.end()) return {};

    auto* tapPlugin = dynamic_cast<studio::WaveformTapPlugin*>(it->second.get());
    if (!tapPlugin) return {};
    return tapPlugin->tap().drain();
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

    // Appended (-1) to the MASTER list, so it sees the mix after everything, exactly like
    // the master level meter it sits beside — that is the signal leaving for the interface.
    auto tap = impl_->session(session).edit->getPluginCache().createNewPlugin(
        studio::BroadcastTapPlugin::xmlTypeName, {});
    if (!tap) return;
    // Point it at the ring BEFORE it joins the list: once inserted, an audio callback can
    // reach it at any moment, and a plugin with no ring yet would drop those blocks.
    if (auto* bt = dynamic_cast<studio::BroadcastTapPlugin*>(tap.get()))
        bt->setTap(&impl_->session(session).broadcastRing);
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
        for (const auto& sid : host_.sessionIds()) emit(sid);
        // Ride this timer rather than add one: the sweep is cheap and the cadence does not matter.
        if (++ticks_ >= kTicksPerReap) {
            ticks_ = 0;
            host_.reapEmptySessions(kSessionTtlMs);
        }
    }

private:
    // Ten minutes untouched, swept once a minute at the 50 ms tick. Both generous: dropping an
    // empty session is invisible, so the only cost of waiting is a map entry.
    static constexpr double kSessionTtlMs = 10 * 60 * 1000.0;
    static constexpr int kTicksPerReap = 1200;
    int ticks_ = 0;

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
