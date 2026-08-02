#pragma once

// The private JUCE state behind EngineHost's PImpl. INTERNAL: it includes Tracktion/JUCE, so server/main.cpp
// must never include it. Impl is the single owner of every piece of JUCE state — behaviour splits across
// several TUs, but STATE stays here undivided, because the declaration and teardown order below is load-bearing
// (juceInit outlives engine, meters detach before the Edit, windows drop before their plugins) and untested.
// Collaborators hold an Impl& and name behaviour; they do not own slices of this state.

#include "EngineHost.h"
#include "EngineTypes.h"
#include "InputTuner.h"
#include "WaveformTap.h"

#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace lanes {

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

struct EngineHost::Impl {
    // JUCE's message manager must outlive `engine`, so declaring it first constructs it first and destroys it last.
    // Owning it here is what lets the server stay free of any JUCE include.
    juce::ScopedJuceInitialiser_GUI juceInit;
    te::Engine engine{"Lanes", nullptr, std::make_unique<ServerBehaviour>()};
    std::unique_ptr<te::Edit> edit;
    std::unique_ptr<juce::Timer> stateTimer;   // periodic state broadcast

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
    std::unique_ptr<te::LevelMeasurer::Client> masterClient;

    void detachLevelMeters() {
        for (size_t i = 0; i < levelMeters.size() && i < levelClients.size(); ++i)
            if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(levelMeters[i].get()))
                lm->measurer.removeClient(*levelClients[i]);
        levelMeters.clear();
        levelClients.clear();
        if (masterClient)
            if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(masterMeter.get()))
                lm->measurer.removeClient(*masterClient);
        masterMeter = nullptr;
        masterClient.reset();
    }

    // The I/O panel's tuner: a second audio callback on the device manager, reading raw interface inputs. Held
    // here so it outlives every Edit like the input meters do, and registered LAZILY — an engine nobody is
    // tuning through never adds a callback at all. See InputTuner.h.
    InputTuner tuner;
    bool tunerAttached = false;

    // Per-INPUT-device metering clients, keyed by device. The devices are ENGINE-level and outlive every Edit, so
    // unlike the output meters these are not rebuilt per project: they attach lazily on the first poll of a track
    // fed by that device and stay for the engine's life, reading the live signal used for monitoring and recording.
    std::map<te::InputDevice*, std::unique_ptr<te::LevelMeasurer::Client>> inputClients;

    te::LevelMeasurer::Client& inputClientFor(te::InputDevice& dev) {
        auto& slot = inputClients[&dev];
        if (!slot) {
            slot = std::make_unique<te::LevelMeasurer::Client>();
            dev.levelMeasurer.addClient(*slot);
        }
        return *slot;
    }

    // Unregister every input client before the devices (and their measurers) go away. From ~EngineHost only: the
    // devices are engine-level, so this survives project reloads and must run before the device manager is torn down.
    void detachInputClients() {
        for (auto& [dev, client] : inputClients)
            if (dev != nullptr && client)
                dev->levelMeasurer.removeClient(*client);
        inputClients.clear();
    }

    // Sinks invoked after a plugin editor closes: presetSavedCb when its state went to the module's .vstpreset,
    // pluginParamsCb when text params fully captured it.
    std::function<void(const std::string&, const std::string&)> presetSavedCb;
    std::function<void(const std::string&, const std::string&)> pluginParamsCb;

    // Plugins a client asked to watch, each mapped to the values last reported. The key's presence IS the
    // subscription and the map is the comparison baseline, so a still plugin costs nothing on the wire.
    // NOT cleared with the edit, unlike pluginsById: a rebuild swaps the plugin behind an id while the client's
    // interest is unchanged, so dropping the watch would silently stop a UI that is still open. The baseline is
    // emptied instead, so the first pump after a rebuild re-reports in full rather than diffing against the old one.
    std::map<std::string, std::map<std::string, double>> watchedParams;
    std::function<void(const std::string&, const std::vector<std::pair<std::string, double>>&)>
        pluginParamsLiveCb;

    // Takes in flight: track id -> the basename prepareTakes() chose, populated at play() and consumed at stop.
    std::map<std::string, std::string> pendingTakes;
    std::function<void(const std::string&, const std::string&, double, double)> recordedCb;

    // Listens for the end of a take. Owned here rather than by the transport, which dies with each Edit: it is
    // added on every applyFull and removed in teardown, while this object outlives both.
    std::unique_ptr<te::TransportControl::Listener> recordListener;

    te::TransportControl* transport() {
        return edit ? &edit->getTransport() : nullptr;
    }
};

}  // namespace lanes
