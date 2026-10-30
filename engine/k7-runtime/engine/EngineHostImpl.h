// The private JUCE state behind EngineHost's PImpl. INTERNAL: it includes Tracktion/JUCE, so server/
// must never include it. Impl is the single owner of every piece of JUCE state — behaviour splits across
// several TUs, but STATE stays here undivided, because the declaration and teardown order below is load-bearing
// (juceInit outlives engine, meters detach before the Edit, windows drop before their plugins) and untested.
// Collaborators hold an Impl& and name behaviour; they do not own slices of this state.

#pragma once

#include "EngineHost.h"
#include "EngineTypes.h"
#include "BroadcastTap.h"
#include "CallbackWatchdog.h"
#include "HangWatch.h"
#include "RecorderNode.h"
#include "RecorderWriter.h"
#include "RenderPool.h"
#include "InputTuner.h"
#include "SessionRegistry.h"
#include "WaveformTap.h"

#include <atomic>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

namespace studio {

// Move the open device onto the buffer size the engine asks for, or the nearest — shared by the one-time open and every later interface switch, so a pick cannot silently change quality band (docs/audioDevice.md).
void applyPreferredBufferSize(juce::AudioDeviceManager& jdm);

// Take the inputs from the OUTPUT device when it has some and a restored setup took them elsewhere; true when it moved them (docs/audioDevice.md).
bool keepInputsOnOutputDevice(juce::AudioDeviceManager& jdm);

// Open the default output of the first backend that has one, ASIO last, when a restored setup left none; true when it did (docs/audioDevice.md).
bool openDefaultOutputIfNone(juce::AudioDeviceManager& jdm);

// A phone keeps every core for its render pool: the desktop cap was never measured there (docs/renderPool.md).
#if JUCE_ANDROID || JUCE_IOS
inline constexpr bool kCapRenderPool = false;
#else
inline constexpr bool kCapRenderPool = true;
#endif

// The server's engine opens NO device at construction: Tracktion would replay its own Settings.xml, a second source of truth that wedges the single-client ASIO driver (docs/audioDevice.md).
struct ServerBehaviour : te::EngineBehaviour {
    // The render pool, decided before any Edit plays: the strategy is process-wide in Tracktion (docs/renderPool.md).
    ServerBehaviour()
        : pool(RenderPool::fromEnv(juce::SystemStats::getNumCpus(), kCapRenderPool,
                                   std::getenv("STUDIO_ENGINE_AUDIO_THREADS"), std::getenv("STUDIO_ENGINE_AUDIO_POOL"))) {
        te::EditPlaybackContext::setThreadPoolStrategy(pool.strategy);
        std::cerr << "[audio] render pool: " << pool.threads << " threads, strategy " << pool.strategy << "\n";
    }
    bool autoInitialiseDeviceManager() override { return false; }
    int getNumberOfCPUsToUseForAudio() override { return pool.threads; }
    const RenderPool pool;
};

// Everything belonging to ONE project, so it can exist N times where Impl holds what the MACHINE has one of; the ring is declared FIRST to die LAST, after the audio-thread plugin writing into it (docs/multiEdit.md).
struct Session {
    BroadcastTap broadcastRing;
    // …and one ring per RECORDER node, by plugin id, for the same reason and one more: a rebuild
    // of the chain around a node must not end the take it is writing (docs/recorder.md).
    // Shared with the writer thread, which holds a node while it records (docs/recorder.md).
    std::map<std::string, std::shared_ptr<RecorderNode>> recorders;
    // …and the nodes whose plugin LEFT, kept until the old playback graph that still writes into their ring has been replaced (docs/recorder.md).
    std::vector<std::pair<double, std::shared_ptr<RecorderNode>>> retiredRecorders;

    std::unique_ptr<te::Edit> edit;
    ProjectDoc current;     // the diff baseline — what this session's engine state IS
    bool halfBuilt = false;   // an applyFull did not finish: the edit is not what `current` says, so the next apply rebuilds
    std::string baseDir;    // resolves this session's clip/plugin paths

    // Plugins in the running edit by PluginDoc id, plus the native windows kept hidden after close; both clear on rebuild, windows first.
    std::map<std::string, te::Plugin::Ptr> pluginsById;
    std::map<std::string, std::unique_ptr<juce::DocumentWindow>> pluginWindows;
    std::map<std::string, std::string> presetSaveById;   // id -> module's .vstpreset save path
    std::map<std::string, juce::MemoryBlock> lastSavedState;   // id -> state at last autosave (skip no-ops)
    // id -> the throwaway instance an autosave round-trips params through, kept rather than built every five seconds (docs/pluginEditors.md).
    std::map<std::string, te::Plugin::Ptr> paramProbes;

    // Per-track output metering, rebuilt with the edit; the clients detach before the old measurers die (docs/meterClients.md).
    std::vector<te::Plugin::Ptr> levelMeters;
    std::vector<std::unique_ptr<te::LevelMeasurer::Client>> levelClients;

    // Per-module waveform taps, one plugin per enabled widget, keyed "chain:module:side": it captures in processBlock, the message thread drains.
    std::map<std::string, te::Plugin::Ptr> waveformPlugins;

    // The same pair for the MASTER plugin list, separate because the master is not one of the audio tracks and is asked for on its own.
    te::Plugin::Ptr masterMeter;
    // The song's output level as a plain gain BEFORE that meter, so the meter reports what leaves; Tracktion's own fader cannot pass +6 dB (MasterGainPlugin.h).
    te::Plugin::Ptr masterGain;
    std::unique_ptr<te::LevelMeasurer::Client> masterClient;
    // A SECOND client on the same meter for the 20 Hz state frame, because getAndClear* CLEARS what it reads (docs/meterClients.md).
    std::unique_ptr<te::LevelMeasurer::Client> masterStateClient;

    // The network broadcast tap; `broadcastWanted` outlives the plugin so an apply can reassert it, otherwise a listener goes silent when somebody saves.
    te::Plugin::Ptr broadcastPlugin;
    bool broadcastWanted = false;

    // Whether rolling RECORDS — a wish outliving the Edit, per session: global, a deck arming would record into k7's take.
    bool recordEnabled = false;

    // Watched plugins -> values last reported, the key itself being the subscription; NOT cleared with the edit, only the baseline emptied, since a rebuild swaps the plugin behind a standing interest.
    std::map<std::string, std::map<std::string, double>> watchedParams;

    // Bumped by every stop and every punch-in: a punch-in's delayed mute fires only if no stop came since (docs/engineHost.md).
    unsigned rollGen = 0;
    // Where the current record roll's punch-in sits, in seconds: before it, the roll is still counting in.
    double punchAt = 0.0;
    // The clips a punch-in muted: the CLIPS and not the lane, whose mute would silence the live input too (docs/engineHost.md).
    std::vector<te::Clip::Ptr> punchMuted;

    // Takes in flight: track id -> the basename prepareTakes() chose, populated at play() and consumed at stop.
    std::map<std::string, std::string> pendingTakes;

    // Listens for the end of a take; owned here rather than by the transport, which dies with each Edit.
    std::unique_ptr<te::TransportControl::Listener> recordListener;

    // When this session was last created or applied to, for reapEmptySessions. Message thread only.
    double lastTouchedMs = 0.0;

    // How many sockets declared themselves DRIVERS ({"role":"driver"} on hello), and when the last went — 0 while somebody drives, so the drop can be delayed (docs/sessions.md).
    int drivers = 0;
    double noDriverSinceMs = 0.0;

    // Whether this session can be forgotten: it HOLDS nothing and has been quiet a while, so the next message naming it recreates exactly this (docs/sessions.md).
    // `recordEnabled` alone keeps nothing alive: with no Edit there is nothing to record into, and a client naming a stray id would pin it for ever.
    bool reapable(double nowMs, double ttlMs) const {
        return !edit && !broadcastWanted && watchedParams.empty() &&
               pendingTakes.empty() && (nowMs - lastTouchedMs) > ttlMs;
    }

    // Whether the project should be let go: it HAD a driver, has none now, and the grace has run out — a session that never had one is never freed this way (docs/sessions.md).
    bool abandoned(double nowMs, double graceMs) const {
        return edit && drivers == 0 && noDriverSinceMs > 0.0 &&
               (nowMs - noDriverSinceMs) > graceMs;
    }

    void detachLevelMeters() {
        for (size_t i = 0; i < levelMeters.size() && i < levelClients.size(); ++i)
            if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(levelMeters[i].get()))
                lm->measurer.removeClient(*levelClients[i]);
        levelMeters.clear();
        levelClients.clear();
        if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(masterMeter.get())) {
            if (masterClient) lm->measurer.removeClient(*masterClient);
            if (masterStateClient) lm->measurer.removeClient(*masterStateClient);
        }
        masterMeter = nullptr;
        masterClient.reset();
        masterStateClient.reset();
        // The gain is FOUND in the edit rather than made, but held all the same — docs/engineHost.md.
        masterGain = nullptr;
    }

    te::TransportControl* transport() {
        return edit ? &edit->getTransport() : nullptr;
    }
};

// Unmute what the punch-in muted, and forget it — every end of a record roll calls this.
void restorePunchMute(Session& s);

struct EngineHost::Impl {
    // JUCE's message manager must outlive `engine`, so it is declared first; owning it here keeps the server free of any JUCE include.
    juce::ScopedJuceInitialiser_GUI juceInit;

    te::Engine engine{"Studio", nullptr, std::make_unique<ServerBehaviour>()};
    std::unique_ptr<juce::Timer> stateTimer;   // periodic state broadcast
    std::unique_ptr<juce::Timer> midiScanTimer;   // the MIDI device rescan, held off while anything plays (docs/audioDevice.md)

    // What the open device costs, PUBLISHED by the message thread on every open or change; atomic because `whoami` answers on the socket's own thread (publishAudioTiming).
    std::atomic<int> audioBufferFrames{0};
    std::atomic<double> audioSampleRate{0.0};

    // Whether the open device still calls back, checked once a second by the state timer — message thread only (docs/audioDevice.md).
    CallbackWatchdog callbackWatchdog;
    // When the state timer last ticked, by juce::Time::getMillisecondCounter, 0 before its first: the message thread's pulse (docs/hangWatch.md).
    std::atomic<juce::uint32> messageHeartbeatMs{0};
    // The thread that reads that pulse and the audio callback's, and leaves when either stopped (docs/hangWatch.md).
    HangWatchdog hangWatchdog;
    // The open device's underrun count at the last check, -1 = no baseline yet; and whether the buffer cap was already reported (checkXRuns).
    int xruns = -1;
    bool xrunsAtCap = false;
    // The buffer the cap was reached at: a device reopened at another size is probed again.
    int xrunsCapFrames = 0;

    // The count-in mode last written to Tracktion's ENGINE-GLOBAL property storage, -1 = never (EngineHost::play says why it is shadowed once per process).
    int countInApplied = -1;

    // The sessions, by id, declared AFTER `engine` so they die BEFORE it; held by unique_ptr so the map can grow without moving the ring the audio thread writes into.
    SessionRegistry<Session> sessions;

    // The session by that id, CREATED empty if new — only for a client declaring it drives this project; every reader wants find().
    Session& session(const std::string& id) {
        bool created = false;
        Session& s = sessions.emplace(id, &created);
        // Stamped on birth so a session created and not yet applied to is not instantly reapable.
        if (created) s.lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
        return s;
    }

    // …or nullptr. For readers that must not conjure a session by asking about one.
    Session* find(const std::string& id) { return sessions.find(id); }

    // The thread that writes every recorder's take, declared after `sessions` so it is joined before they die (docs/recorder.md).
    RecorderWriter recorderWriter;

    // Forget a session entirely — its Edit, plugins, meters and taps: what `flush` means once it addresses one project.
    void drop(const std::string& id) {
        // Handed to the writer to close, never waited for: it holds the nodes, so a take still recording closes after the session is gone.
        if (auto* s = find(id))
            for (auto& [_, node] : s->recorders) recorderWriter.finish(node.get());
        sessions.erase(id);
    }

    // Which sessions exist, for the state timer: one frame per session, and one nobody sent a project to has nothing to report.
    std::vector<std::string> ids() const { return sessions.ids(); }

    // The I/O panel's tuner — a second audio callback reading raw interface inputs, outliving every Edit and registered LAZILY (InputTuner.h).
    InputTuner tuner;
    bool tunerAttached = false;

    // Per-INPUT-device metering clients, keyed by NAME and physical CHANNELS rather than pointer: a list rebuild destroys every device, and two may share a label (docs/meterClients.md).
    struct InputClient {
        te::InputDevice* dev = nullptr;
        std::unique_ptr<te::LevelMeasurer::Client> client;
    };
    std::map<std::string, InputClient> inputClients;

    static std::string inputKey(te::InputDevice& dev) {
        std::string k = dev.getName().toStdString();
        if (auto* w = dynamic_cast<te::WaveInputDevice*>(&dev))
            for (const auto& c : w->getChannels()) k += "@" + std::to_string(c.indexInDevice);
        return k;
    }

    te::LevelMeasurer::Client& inputClientFor(te::InputDevice& dev) {
        auto& slot = inputClients[inputKey(dev)];
        // A rebuilt device carries a new measurer, so the orphaned client is DROPPED rather than removed — removing would touch freed memory.
        if (!slot.client || slot.dev != &dev) {
            slot.client = std::make_unique<te::LevelMeasurer::Client>();
            slot.dev = &dev;
            dev.levelMeasurer.addClient(*slot.client);
        }
        return *slot.client;
    }

    // Unregister every input client before the devices go away — from ~EngineHost only, and only from devices STILL THERE (docs/meterClients.md).
    void detachInputClients() {
        std::set<te::InputDevice*> live;
        for (auto* d : engine.getDeviceManager().getWaveInputDevices())
            if (d != nullptr) live.insert(d);
        for (auto& [name, slot] : inputClients)
            if (slot.client && slot.dev != nullptr && live.count(slot.dev))
                slot.dev->levelMeasurer.removeClient(*slot.client);
        inputClients.clear();
    }

    // Sink invoked after a plugin editor closes, when text params captured it; leads with its session.
    std::function<void(const std::string&, const std::string&, const std::string&)> pluginParamsCb;

    // The live-param and recorded-take sinks stay on Impl, being the SERVER's one per process; they lead with a session because a frame nobody can route is one every client reads.
    std::function<void(const std::string&, const std::string&,
                       const std::vector<std::pair<std::string, double>>&)>
        pluginParamsLiveCb;
    std::function<void(const std::string&, const std::string&, const std::string&, double, double)>
        recordedCb;

    // A session's transport, or nullptr when there is no such session or it carries no Edit.
    te::TransportControl* transport(const std::string& id) {
        auto* s = find(id);
        return s ? s->transport() : nullptr;
    }
};

}  // namespace studio
