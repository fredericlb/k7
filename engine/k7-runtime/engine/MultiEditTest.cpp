// MultiEditTest.cpp — a THROWAWAY probe answering one question: can several Edits play at
// once through one audio device? Tracktion's DeviceManager holds `activeContexts` as an
// ARRAY and sums them in the callback, so the code says yes; this runs it. Delete once the
// answer is written down. See docs/multiEdit.md.

#include "EngineHost.h"

#include "EngineTypes.h"
#include "EditBuilder.h"
#include "PluginScan.h"
#include "MessagePump.h"

#include <chrono>
#include <iostream>
#include <memory>
#include <vector>

namespace studio {

namespace {
// Do NOT let Tracktion reopen whatever device it last persisted: a remembered ASIO device reopened by a second process is exactly the wedge this probe is about.
struct ProbeBehaviour : te::EngineBehaviour {
    bool autoInitialiseDeviceManager() override { return false; }
};
}  // namespace

// Play every document at once on one device and report each one's MASTER LEVEL — a context accepted but never run reports silence, which is the failure worth catching.
int runMultiEditTest(const std::vector<ProjectDoc>& docs,
                     const std::vector<std::string>& baseDirs, double seconds,
                     const std::string& deviceName, const std::string& deviceType) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    te::Engine engine{"Studio", nullptr, std::make_unique<ProbeBehaviour>()};
    registerBuiltInPlugins(engine);

    auto& dm = engine.getDeviceManager();
    dm.initialise(512, 2);

    // Switching the BACKEND is the point of the flag — Windows Audio proves nothing about one exclusive ASIO client hosting several Edits — and the type goes first.
    if (!deviceName.empty()) {
        auto& jdm = dm.deviceManager;
        const juce::String wanted(deviceName), wantedType(deviceType);
        for (auto* t : jdm.getAvailableDeviceTypes()) {
            if (t == nullptr) continue;
            if (wantedType.isNotEmpty() && !t->getTypeName().equalsIgnoreCase(wantedType))
                continue;
            t->scanForDevices();
            if (!t->getDeviceNames(false).contains(wanted)) continue;
            jdm.setCurrentAudioDeviceType(t->getTypeName(), true);
            auto setup = jdm.getAudioDeviceSetup();
            setup.outputDeviceName = wanted;
            if (t->getDeviceNames(true).contains(wanted)) setup.inputDeviceName = wanted;
            setup.useDefaultInputChannels = true;
            setup.useDefaultOutputChannels = true;
            const auto err = jdm.setAudioDeviceSetup(setup, true);
            if (err.isNotEmpty())
                std::cerr << "[probe] device switch failed: " << err.toStdString() << "\n";
            break;
        }
    }
    if (auto* dev = dm.deviceManager.getCurrentAudioDevice())
        std::cerr << "[probe] device '" << dev->getName().toStdString()
                  << "' (" << dev->getTypeName().toStdString() << ") open, buffer "
                  << dev->getCurrentBufferSizeSamples() << " @ "
                  << dev->getCurrentSampleRate() << " Hz = "
                  << (1000.0 * dev->getCurrentBufferSizeSamples() / dev->getCurrentSampleRate())
                  << " ms\n";
    else {
        std::cerr << "[probe] NO audio device — the probe would measure nothing\n";
        return 2;
    }

    struct Session {
        std::unique_ptr<te::Edit> edit;
        te::Plugin::Ptr meter;
        std::unique_ptr<te::LevelMeasurer::Client> client;
        float peak = -100.0f;
    };
    std::vector<std::unique_ptr<Session>> sessions;

    for (size_t i = 0; i < docs.size(); ++i) {
        auto s = std::make_unique<Session>();
        s->edit = te::Edit::createSingleTrackEdit(engine);
        populateEdit(engine, *s->edit, docs[i],
                     i < baseDirs.size() ? baseDirs[i] : std::string{});

        // A meter on the MASTER list, the one place an Edit's outgoing mix is readable, exactly as buildLevelMeters does it.
        auto meter = s->edit->getPluginCache().createNewPlugin(
            te::LevelMeterPlugin::xmlTypeName, {});
        if (auto* lm = dynamic_cast<te::LevelMeterPlugin*>(meter.get())) {
            s->edit->getMasterPluginList().insertPlugin(meter, -1, nullptr);
            s->client = std::make_unique<te::LevelMeasurer::Client>();
            lm->measurer.addClient(*s->client);
            s->meter = meter;
        }

        sessions.push_back(std::move(s));
    }

    // Pump BEFORE allocating contexts: populateEdit builds 4OSC and Sampler voices on async message-thread work, and without this the probe reported playing=no on both.
    for (int i = 0; i < 20; ++i)
        pumpMessages(50);

    // THIS is the call under test: each Edit registering its own playback context with the one shared DeviceManager.
    for (size_t i = 0; i < sessions.size(); ++i) {
        sessions[i]->edit->getTransport().ensureContextAllocated();
        std::cerr << "[probe] session " << i << " context allocated\n";
    }
    for (int i = 0; i < 10; ++i)
        pumpMessages(50);

    for (auto& s : sessions) s->edit->getTransport().play(false);

    // …and again after play: the transport's start is itself dispatched.
    for (int i = 0; i < 10; ++i)
        pumpMessages(50);
    for (size_t i = 0; i < sessions.size(); ++i)
        std::cerr << "[probe] session " << i << " transport playing="
                  << (sessions[i]->edit->getTransport().isPlaying() ? "yes" : "no") << "\n";

    // Pump the message loop while sampling: Tracktion needs it, and the meters are read from here rather than from the audio thread.
    const auto until = std::chrono::steady_clock::now() +
                       std::chrono::milliseconds((long long)(seconds * 1000));
    while (std::chrono::steady_clock::now() < until) {
        pumpMessages(100);
        for (auto& s : sessions)
            if (s->client) {
                const auto lv = s->client->getAndClearAudioLevel(0);
                if (lv.dB > s->peak) s->peak = lv.dB;
            }
    }

    int silent = 0;
    for (size_t i = 0; i < sessions.size(); ++i) {
        const bool playing = sessions[i]->edit->getTransport().isPlaying();
        std::cerr << "[probe] session " << i << ": playing=" << (playing ? "yes" : "no")
                  << " peak=" << sessions[i]->peak << " dB\n";
        if (sessions[i]->peak <= -99.0f) ++silent;
    }

    for (auto& s : sessions) s->edit->getTransport().stop(false, false);

    if (silent == 0) {
        std::cerr << "[probe] ALL " << sessions.size()
                  << " sessions produced signal on one device.\n";
        return 0;
    }
    std::cerr << "[probe] " << silent << " of " << sessions.size()
              << " sessions were SILENT — several Edits do not mix here.\n";
    return 1;
}

}  // namespace studio
