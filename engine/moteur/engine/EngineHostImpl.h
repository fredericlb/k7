// The private JUCE state behind EngineHost's PImpl. INTERNAL: it includes Tracktion/JUCE, so server/main.cpp
// must never include it. Impl is the single owner of every piece of JUCE state — behaviour splits across
// several TUs, but STATE stays here undivided, because the declaration and teardown order below is load-bearing
// (juceInit outlives engine, meters detach before the Edit, windows drop before their plugins) and untested.
// Collaborators hold an Impl& and name behaviour; they do not own slices of this state.

#pragma once

#include "EngineHost.h"
#include "EngineTypes.h"
#include "BroadcastTap.h"
#include "InputTuner.h"
#include "SessionRegistry.h"
#include "WaveformTap.h"

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

namespace studio {

// Move the open device onto the buffer size the engine asks for, or the nearest — shared by the one-time open and every later interface switch, so a pick cannot silently change quality band (docs/audioDevice.md).
void applyPreferredBufferSize(juce::AudioDeviceManager& jdm);

// The server's engine opens NO device at construction: Tracktion would replay its own Settings.xml, a second source of truth that wedges the single-client ASIO driver (docs/audioDevice.md).
struct ServerBehaviour : te::EngineBehaviour {
    bool autoInitialiseDeviceManager() override { return false; }
};

// Everything belonging to ONE project, so it can exist N times where Impl holds what the MACHINE has one of; the ring is declared FIRST to die LAST, after the audio-thread plugin writing into it (docs/multiEdit.md).
struct Session {
    BroadcastTap broadcastRing;

    std::unique_ptr<te::Edit> edit;
    ProjectDoc current;     // the diff baseline — what this session's engine state IS
    std::string baseDir;    // resolves this session's clip/plugin paths

    // Plugins in the running edit by PluginDoc id, plus the native windows kept hidden after close; both clear on rebuild, windows first.
    std::map<std::string, te::Plugin::Ptr> pluginsById;
    std::map<std::string, std::unique_ptr<juce::DocumentWindow>> pluginWindows;
    std::map<std::string, std::string> presetSaveById;   // id -> module's .vstpreset save path
    std::map<std::string, juce::MemoryBlock> lastSavedState;   // id -> state at last autosave (skip no-ops)

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

    // Whether rolling RECORDS — a wish outliving the Edit, per session: global, a deck arming would record into st0's take.
    bool recordEnabled = false;

    // Watched plugins -> values last reported, the key itself being the subscription; NOT cleared with the edit, only the baseline emptied, since a rebuild swaps the plugin behind a standing interest.
    std::map<std::string, std::map<std::string, double>> watchedParams;

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
    bool reapable(double nowMs, double ttlMs) const {
        return !edit && !broadcastWanted && !recordEnabled && watchedParams.empty() &&
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

struct EngineHost::Impl {
    // JUCE's message manager must outlive `engine`, so it is declared first; owning it here keeps the server free of any JUCE include.
    juce::ScopedJuceInitialiser_GUI juceInit;

    te::Engine engine{"Studio", nullptr, std::make_unique<ServerBehaviour>()};
    std::unique_ptr<juce::Timer> stateTimer;   // periodic state broadcast

    // What the open device costs, PUBLISHED by the message thread on every open or change; atomic because `whoami` answers on the socket's own thread (publishAudioTiming).
    std::atomic<int> audioBufferFrames{0};
    std::atomic<double> audioSampleRate{0.0};

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

    // Forget a session entirely — its Edit, plugins, meters and taps: what `flush` means once it addresses one project.
    void drop(const std::string& id) { sessions.erase(id); }

    // Which sessions exist, for the state timer: one frame per session, and one nobody sent a project to has nothing to report.
    std::vector<std::string> ids() const { return sessions.ids(); }

    // The I/O panel's tuner — a second audio callback reading raw interface inputs, outliving every Edit and registered LAZILY (InputTuner.h).
    InputTuner tuner;
    bool tunerAttached = false;

    // Per-INPUT-device metering clients, keyed by device NAME rather than pointer because a wave-device-list rebuild destroys every WaveInputDevice (docs/meterClients.md).
    struct InputClient {
        te::InputDevice* dev = nullptr;
        std::unique_ptr<te::LevelMeasurer::Client> client;
    };
    std::map<std::string, InputClient> inputClients;

    te::LevelMeasurer::Client& inputClientFor(te::InputDevice& dev) {
        auto& slot = inputClients[dev.getName().toStdString()];
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

    // Sinks invoked after a plugin editor closes — presetSavedCb for a .vstpreset write, pluginParamsCb when text params captured it; each leads with its session.
    std::function<void(const std::string&, const std::string&, const std::string&)> presetSavedCb;
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
