#pragma once

// The private JUCE state behind EngineHost's PImpl. INTERNAL: it includes Tracktion/JUCE, so server/main.cpp
// must never include it. Impl is the single owner of every piece of JUCE state — behaviour splits across
// several TUs, but STATE stays here undivided, because the declaration and teardown order below is load-bearing
// (juceInit outlives engine, meters detach before the Edit, windows drop before their plugins) and untested.
// Collaborators hold an Impl& and name behaviour; they do not own slices of this state.

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

/**
 * Move the open device onto the buffer size the engine asks for (AudioDevices.cpp), or the
 * nearest it offers.
 *
 * Declared here rather than being file-local because BOTH device paths need it and they live in
 * different TUs: the one-time open (EngineHost.cpp) and every later switch of interface
 * (AudioDevices.cpp). A device opened at 256 frames that silently went back to the driver's own
 * on the next pick would move the engine between quality bands with nothing said.
 */
void applyPreferredBufferSize(juce::AudioDeviceManager& jdm);

/**
 * The server's engine opens NO device at construction — openAudioDevice() does it, later and on purpose.
 *
 * Tracktion's constructor otherwise restores whatever device it last persisted in its own Settings.xml, which
 * made that file a second, hidden source of truth for the interface, ahead of preferences.yaml and applied
 * before anything here runs. It also meant the "deliberately NOT opened here" below was not true.
 *
 * That replay is what wedged the driver: an ASIO device is single-client, and a remembered one gets reopened by
 * every process that constructs an engine — including an offline render (now headless too, see makeOfflineEngine).
 */
struct ServerBehaviour : te::EngineBehaviour {
    bool autoInitialiseDeviceManager() override { return false; }
};

/**
 * Everything that belongs to ONE project, and therefore to one service's user.
 *
 * The split from Impl is the whole point: what is here can exist N times, what stays in
 * Impl exists once because the MACHINE has one of it — one audio device, one plugin scan,
 * one set of input meters. `docs/multiEdit.md` records the measurement that made this
 * possible: Tracktion's DeviceManager sums several EditPlaybackContexts in one callback, so
 * N projects share one exclusive ASIO client at its own buffer size, with no latency traded.
 *
 * The ring is declared FIRST so it is destroyed LAST within a session: a live
 * BroadcastTapPlugin on the master list writes into it from the audio thread, and the
 * plugin dies with `edit`, which is declared after.
 */
struct Session {
    BroadcastTap broadcastRing;

    std::unique_ptr<te::Edit> edit;
    ProjectDoc current;     // the diff baseline — what this session's engine state IS
    std::string baseDir;    // resolves this session's clip/plugin paths

    // Plugins in the running edit keyed by PluginDoc id, so a command can address one by name, plus the native
    // editor windows (kept alive but hidden after close, so reopening is instant), keyed the same way. Both clear
    // when the edit is rebuilt, which destroys the windows before their plugins die.
    std::map<std::string, te::Plugin::Ptr> pluginsById;
    std::map<std::string, std::unique_ptr<juce::DocumentWindow>> pluginWindows;
    std::map<std::string, std::string> presetSaveById;   // id -> module's .vstpreset save path
    std::map<std::string, juce::MemoryBlock> lastSavedState;   // id -> state at last autosave (skip no-ops)

    // Per-track output metering: a post-fader LevelMeterPlugin per track plus a client we poll, indexed by track.
    // Rebuilt with the edit, and the clients are detached before the old edit's measurers are torn down, so the
    // audio thread never touches a freed client.
    std::vector<te::Plugin::Ptr> levelMeters;
    std::vector<std::unique_ptr<te::LevelMeasurer::Client>> levelClients;

    // Per-module waveform taps, one plugin per enabled widget, keyed "chain:module:side". The plugin sits in the
    // chain and captures audio in processBlock; the message thread drains the envelope.
    std::map<std::string, te::Plugin::Ptr> waveformPlugins;

    // The same pair for the MASTER plugin list — the signal actually leaving for the interface. Separate because
    // the master is not one of the audio tracks, and its meter has to survive being asked for on its own.
    te::Plugin::Ptr masterMeter;
    // The song's output level, as a plain gain BEFORE the meter above — so what the meter reports
    // is what leaves, trim included. Tracktion's own master fader stays pinned at unity; it cannot
    // go past +6 dB, which is the whole reason this one exists (MasterGainPlugin.h).
    te::Plugin::Ptr masterGain;
    std::unique_ptr<te::LevelMeasurer::Client> masterClient;
    // A SECOND client on the same master meter, for the 20 Hz state frame.
    //
    // Not a luxury: `getAndClearAudioLevel` and `getAndClearOverload` both CLEAR what they read, so
    // two readers sharing one client steal each other's measurements — whoever asks first gets the
    // peak and the other gets silence. `io-levels` (the I/O panel, on demand) keeps `masterClient`;
    // the state frame every surface watches gets its own. A measurer takes as many clients as it is
    // given, and each keeps its own accumulator, which is the whole reason per-track meters work.
    std::unique_ptr<te::LevelMeasurer::Client> masterStateClient;

    // The network broadcast tap. `broadcastWanted` outlives the plugin: an apply rebuilds
    // the edit, so the WISH is what survives in order to be reasserted, otherwise a listener
    // goes silent the moment somebody saves a file, which is the sort of fault nobody
    // connects to a save.
    te::Plugin::Ptr broadcastPlugin;
    bool broadcastWanted = false;

    // Whether rolling the transport RECORDS, per session for the same reason broadcastWanted is:
    // it is a wish that outlives the Edit, and it belongs to one project. Global, a deck arming
    // record would light st0's record light and record into st0's take on the same engine.
    bool recordEnabled = false;

    // Plugins a client asked to watch, each mapped to the values last reported. The key's presence IS the
    // subscription and the map is the comparison baseline, so a still plugin costs nothing on the wire.
    // NOT cleared with the edit, unlike pluginsById: a rebuild swaps the plugin behind an id while the client's
    // interest is unchanged, so dropping the watch would silently stop a UI that is still open. The baseline is
    // emptied instead, so the first pump after a rebuild re-reports in full rather than diffing against the old one.
    std::map<std::string, std::map<std::string, double>> watchedParams;

    // Takes in flight: track id -> the basename prepareTakes() chose, populated at play() and consumed at stop.
    std::map<std::string, std::string> pendingTakes;

    // Listens for the end of a take. Owned here rather than by the transport, which dies with each Edit: it is
    // added on every applyFull and removed in teardown, while this object outlives both.
    std::unique_ptr<te::TransportControl::Listener> recordListener;

    // When this session was last created or applied to, for reapEmptySessions. Message thread only.
    double lastTouchedMs = 0.0;

    /**
     * How many sockets have declared themselves DRIVERS of this session, and when the last of
     * them went.
     *
     * A driver is a surface a person is looking at (`{"role":"driver"}` on hello). The file
     * service is deliberately not one: it holds a socket per session for as long as the machine
     * is up, so counting it would mean no session ever looks abandoned. See docs/sessions.md.
     *
     * `noDriverSinceMs` is 0 while somebody is driving. It exists so the drop can be DELAYED:
     * refcounting alone would take a loaded project away on every tab reload.
     */
    int drivers = 0;
    double noDriverSinceMs = 0.0;

    /**
     * Whether this session can be forgotten: it HOLDS nothing and has been quiet a while.
     *
     * Deliberately not "has no listener" — a browser tab reloads in under a second, and a
     * refcount would take its loaded project with it. Holding nothing makes the drop invisible
     * instead: the next message naming it recreates exactly this, so no work can be lost.
     */
    bool reapable(double nowMs, double ttlMs) const {
        return !edit && !broadcastWanted && !recordEnabled && watchedParams.empty() &&
               pendingTakes.empty() && (nowMs - lastTouchedMs) > ttlMs;
    }

    /**
     * Whether the project this session holds should be let go: it HAD a driver, has none now,
     * and the grace period has run out.
     *
     * The grace is the whole design. A reload, a dropped Wi-Fi, a laptop lid — all of them close
     * the socket, and none of them means "I am done with this project". A session that never had
     * a driver (`noDriverSinceMs == 0`) is never freed this way either: that is the file service
     * on its own, which is how a project gets loaded in the first place.
     */
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
    }

    te::TransportControl* transport() {
        return edit ? &edit->getTransport() : nullptr;
    }
};

struct EngineHost::Impl {
    // JUCE's message manager must outlive `engine`, so declaring it first constructs it first and destroys it last.
    // Owning it here is what lets the server stay free of any JUCE include.
    juce::ScopedJuceInitialiser_GUI juceInit;

    te::Engine engine{"Studio", nullptr, std::make_unique<ServerBehaviour>()};
    std::unique_ptr<juce::Timer> stateTimer;   // periodic state broadcast

    // What the open device costs, PUBLISHED by the message thread whenever it opens or changes.
    // Atomics because `whoami` is answered on the socket's own thread — see publishAudioTiming().
    std::atomic<int> audioBufferFrames{0};
    std::atomic<double> audioSampleRate{0.0};

    // The count-in mode last written to Tracktion's ENGINE-GLOBAL property storage. -1 = never. See
    // EngineHost::play for why a mode that looks per-Edit is shadowed once per process.
    int countInApplied = -1;

    // The sessions, by id. Declared AFTER `engine` so they are destroyed BEFORE it: every
    // Edit, plugin and broadcast ring in here is written to from the audio thread, and the
    // device only stops when `engine` dies.
    //
    // `unique_ptr` rather than by value because a Session holds an atomic ring: the map
    // must be able to grow without moving what the audio thread is writing into.
    SessionRegistry<Session> sessions;

    /** The session by that id, CREATED empty if it is new — only for a client declaring it drives
     *  this project (apply/applyFull, broadcast on, record-enable). Every reader wants find(). */
    Session& session(const std::string& id) {
        bool created = false;
        Session& s = sessions.emplace(id, &created);
        // Stamped on birth so a session created and not yet applied to is not instantly reapable.
        if (created) s.lastTouchedMs = juce::Time::getMillisecondCounterHiRes();
        return s;
    }

    /** …or nullptr. For readers that must not conjure a session by asking about one. */
    Session* find(const std::string& id) { return sessions.find(id); }

    /** Forget a session entirely — its Edit, plugins, meters and taps. What `flush` means
     *  once flush is addressed to one project rather than to the engine. */
    void drop(const std::string& id) { sessions.erase(id); }

    /** Which sessions exist, for the state timer: it emits one frame per session, and a
     *  session nobody has sent a project to has nothing to report. */
    std::vector<std::string> ids() const { return sessions.ids(); }

    // The I/O panel's tuner: a second audio callback on the device manager, reading raw interface inputs. Held
    // here so it outlives every Edit like the input meters do, and registered LAZILY — an engine nobody is
    // tuning through never adds a callback at all. See InputTuner.h.
    InputTuner tuner;
    bool tunerAttached = false;

    // Per-INPUT-device metering clients, keyed by device NAME. The devices are ENGINE-level and outlive every Edit,
    // so unlike the output meters these are not rebuilt per project: they attach lazily on the first poll of a track
    // fed by that device and stay for the engine's life, reading the live signal used for monitoring and recording.
    //
    // By NAME and not by pointer: any change to the wave-device list — enabling a channel is enough — DESTROYS
    // every WaveInputDevice and builds new ones. Keyed by pointer, the map would hold keys into freed memory, grow
    // a second client per rebuild, and have nothing left to read the level through. `dev` records which object the
    // live client is attached to, so a rebuilt device gets a fresh one.
    struct InputClient {
        te::InputDevice* dev = nullptr;
        std::unique_ptr<te::LevelMeasurer::Client> client;
    };
    std::map<std::string, InputClient> inputClients;

    te::LevelMeasurer::Client& inputClientFor(te::InputDevice& dev) {
        auto& slot = inputClients[dev.getName().toStdString()];
        // A rebuilt device is a new object carrying a new measurer. The old client was orphaned when the old
        // measurer died, so it is dropped rather than removed from it — removing would touch freed memory.
        if (!slot.client || slot.dev != &dev) {
            slot.client = std::make_unique<te::LevelMeasurer::Client>();
            slot.dev = &dev;
            dev.levelMeasurer.addClient(*slot.client);
        }
        return *slot.client;
    }

    // Unregister every input client before the devices (and their measurers) go away. From ~EngineHost only: the
    // devices are engine-level, so this survives project reloads and must run before the device manager is torn down.
    //
    // Only from devices that are STILL THERE. A client whose device was destroyed by a wave-device-list rebuild
    // points at a measurer that no longer exists, and removing it from that would be a read of freed memory at
    // shutdown — a crash on exit that would be blamed on whatever ran last.
    void detachInputClients() {
        std::set<te::InputDevice*> live;
        for (auto* d : engine.getDeviceManager().getWaveInputDevices())
            if (d != nullptr) live.insert(d);
        for (auto& [name, slot] : inputClients)
            if (slot.client && slot.dev != nullptr && live.count(slot.dev))
                slot.dev->levelMeasurer.removeClient(*slot.client);
        inputClients.clear();
    }

    // Sinks invoked after a plugin editor closes: presetSavedCb when its state went to the module's .vstpreset,
    // pluginParamsCb when text params fully captured it. Each leads with the session it happened in.
    std::function<void(const std::string&, const std::string&, const std::string&)> presetSavedCb;
    std::function<void(const std::string&, const std::string&, const std::string&)> pluginParamsCb;

    // The live-param and recorded-take sinks stay on Impl: they are the SERVER's, one per
    // process. They lead with a session for the same reason the two above do — one per process
    // does not mean one project, and a frame nobody can route is one every client reads.
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
