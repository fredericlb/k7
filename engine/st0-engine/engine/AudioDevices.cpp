// Audio-interface enumeration and selection: the EngineHost device members
// (listAudioDevices / setAudioDevice / outputDeviceName) and the standalone
// `--list-audio-devices` CLI. Same concern, so enumerateDevices + deviceTypeRank
// stay file-local here — nothing outside this TU needs them.

#include "EngineHost.h"
#include "Warnings.h"

#include "EngineTypes.h"       // Tracktion/JUCE + the te/tt/fs aliases
#include "EngineHostImpl.h"    // struct EngineHost::Impl (device members touch impl_->engine)

#include <algorithm>
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace studio {

namespace {

// The same sentinel trick as the plugin scan, kept in step with the brain's config reader: JUCE and the drivers print to stdout, so the CLI fences its JSON.
constexpr const char* kDevicesBegin = "STUDIO_DEVICES_BEGIN";
constexpr const char* kDevicesEnd = "STUDIO_DEVICES_END";

// ASIO first: on Windows it is the low-latency path, and the other backends usually offer the same interface as a fallback.
int deviceTypeRank(const juce::String& t) {
    if (t.containsIgnoreCase("ASIO")) return 0;
    if (t.containsIgnoreCase("Windows Audio") || t.containsIgnoreCase("WASAPI")) return 1;
    if (t.containsIgnoreCase("DirectSound")) return 2;
    return 3;
}

// Asked of every device we open, in frames — a PREFERENCE and not a promise, and what it costs: docs/audioDevice.md.
constexpr int kPreferredBufferFrames = 256;

// The most a phone's buffer grows to on underruns, in ms: JUCE's own default for a low-latency Android device (docs/android.md).
constexpr int kMaxXRunBufferMs = 40;

// What to ask of this device: kPreferredBufferFrames, but never under two Oboe bursts on a phone — one leaves no slack (docs/android.md).
int preferredBufferFrames([[maybe_unused]] const juce::Array<int>& sizes) {
#if JUCE_ANDROID
    // JUCE lists an Oboe device's sizes as whole bursts, a single burst first.
    return juce::jmax(kPreferredBufferFrames, 2 * sizes[0]);
#else
    return kPreferredBufferFrames;
#endif
}

// Enumerate the interfaces the backends offer, ASIO first and ONE row per name — the dedup and what it costs: docs/audioDevice.md.
std::vector<AudioDeviceInfo> enumerateDevices(juce::AudioDeviceManager& jdm) {
    std::vector<AudioDeviceInfo> out;
    auto* cur = jdm.getCurrentAudioDevice();
    const juce::String curName = cur != nullptr ? cur->getName() : juce::String();
    const juce::String curType = cur != nullptr ? cur->getTypeName() : juce::String();

    for (auto* type : jdm.getAvailableDeviceTypes()) {
        if (type == nullptr) continue;
        type->scanForDevices(); // required before getDeviceNames()
        const juce::String typeName = type->getTypeName();

        // Outputs first: getDefaultDeviceIndex(false) indexes the OUTPUT list, so appended input-only names cannot be mistaken for the default.
        juce::StringArray names = type->getDeviceNames(false);
        for (const auto& n : type->getDeviceNames(true)) names.addIfNotAlreadyThere(n);
        const int defaultOut = type->getDefaultDeviceIndex(false);

        for (int i = 0; i < names.size(); ++i) {
            AudioDeviceInfo info;
            info.name = names[i].toStdString();
            info.type = typeName.toStdString();
            info.isDefault = (i == defaultOut);
            info.current = (names[i] == curName && typeName == curType);
            if (info.current && cur != nullptr) {
                info.inputs = cur->getInputChannelNames().size();
                info.outputs = cur->getOutputChannelNames().size();
            }
            out.push_back(std::move(info));
        }
    }

    std::stable_sort(out.begin(), out.end(), [](const AudioDeviceInfo& a, const AudioDeviceInfo& b) {
        const int ra = deviceTypeRank(juce::String(a.type));
        const int rb = deviceTypeRank(juce::String(b.type));
        if (ra != rb) return ra < rb;
        if (a.type != b.type) return a.type < b.type;
        return a.name < b.name;
    });

    // Keep the first occurrence of each name — the sort put the best-ranked type first — and carry `current` onto the kept row.
    std::vector<AudioDeviceInfo> unique;
    std::map<std::string, size_t> byName;
    for (auto& d : out) {
        auto [it, inserted] = byName.try_emplace(d.name, unique.size());
        if (inserted)
            unique.push_back(std::move(d));
        else if (d.current)
            unique[it->second].current = true;
    }
    return unique;
}

}  // namespace

// Move the open device to kPreferredBufferFrames or the nearest size it offers, ties going to the LARGER — docs/audioDevice.md.
void applyPreferredBufferSize(juce::AudioDeviceManager& jdm) {
    auto* dev = jdm.getCurrentAudioDevice();
    if (dev == nullptr) return;

    const auto sizes = dev->getAvailableBufferSizes();
    if (sizes.isEmpty()) return; // the driver owns it — nothing to ask for
    const int preferred = preferredBufferFrames(sizes);
    int want = sizes[0];
    for (const int s : sizes) {
        const int d = std::abs(s - preferred);
        const int best = std::abs(want - preferred);
        if (d < best || (d == best && s > want)) want = s;
    }
    if (want == dev->getCurrentBufferSizeSamples()) return;

    auto setup = jdm.getAudioDeviceSetup();
    setup.bufferSize = want;
    const auto err = jdm.setAudioDeviceSetup(setup, true);
    if (err.isNotEmpty()) {
        std::cerr << "[audio] kept the device's own buffer ("
                  << dev->getCurrentBufferSizeSamples() << " frames): " << err << "\n";
        return;
    }
    std::cerr << "[audio] buffer " << want << " frames";
    if (want != preferred)
        std::cerr << " (nearest this device offers to " << preferred << ")";
    std::cerr << "\n";
}

std::vector<AudioDeviceInfo> EngineHost::listAudioDevices() {
    return enumerateDevices(impl_->engine.getDeviceManager().deviceManager);
}

// Open a specific interface (input + output); an empty `type` means the first backend offering the name, and an unknown name warns rather than crashes.
bool EngineHost::setAudioDevice(const std::string& name, const std::string& type) {
    // Publish on EVERY exit: the rollback paths below reopen a device too, and a stale buffer/rate would band the link wrong until the next switch.
    struct PublishOnExit {
        EngineHost* host;
        ~PublishOnExit() { host->publishAudioTiming(); }
    } publishOnExit{this};

    auto& dm = impl_->engine.getDeviceManager();
    auto& jdm = dm.deviceManager;
    const juce::String wanted(name);
    const juce::String wantedType(type);

    // Already there: say so and touch nothing — not an optimisation but what stops every reconnect re-wiring a rolling session (docs/audioDevice.md).
    if (auto* cur = jdm.getCurrentAudioDevice();
        cur != nullptr && cur->getName() == wanted
        && (wantedType.isEmpty() || cur->getTypeName().equalsIgnoreCase(wantedType)))
        return true;

    juce::AudioIODeviceType* found = nullptr;
    for (auto* t : jdm.getAvailableDeviceTypes()) {
        if (t == nullptr) continue;
        if (wantedType.isNotEmpty() && !t->getTypeName().equalsIgnoreCase(wantedType)) continue;
        t->scanForDevices();
        if (t->getDeviceNames(false).contains(wanted) || t->getDeviceNames(true).contains(wanted)) {
            found = t;
            break;
        }
    }
    if (found == nullptr) {
        warn("audio device not found: " + name);
        return false;
    }

    // Switch backend FIRST: setAudioDeviceSetup() only considers the current type, so an ASIO device is invisible while Windows Audio is selected.
    const auto prevType = jdm.getCurrentAudioDeviceType();
    if (!found->getTypeName().equalsIgnoreCase(prevType))
        jdm.setCurrentAudioDeviceType(found->getTypeName(), true);

    // Only name a direction the device actually HAS: an empty name REMOVES that direction, and a blanked output is a silent engine (docs/audioDevice.md).
    const bool hasOut = found->getDeviceNames(false).contains(wanted);
    const bool hasIn = found->getDeviceNames(true).contains(wanted);

    const auto prev = jdm.getAudioDeviceSetup();
    auto setup = prev;
    if (hasOut) setup.outputDeviceName = wanted;
    if (hasIn) setup.inputDeviceName = wanted;
    setup.useDefaultInputChannels = true;
    setup.useDefaultOutputChannels = true;

    // Nothing kept us an output: refuse rather than open a silent engine.
    if (setup.outputDeviceName.isEmpty()) {
        warn("'" + name +
             "' has no outputs and no output device is set — choose an output device first");
        if (!found->getTypeName().equalsIgnoreCase(prevType))
            jdm.setCurrentAudioDeviceType(prevType, true);
        return false;
    }

    // What was armed, BEFORE the switch: afterwards there is only the new device's empty arm flags to read.
    std::map<std::string, std::vector<std::string>> armedBefore;
    for (const auto& sid : impl_->ids())
        if (auto armed = armedTracks(sid); !armed.empty()) armedBefore[sid] = std::move(armed);

    const auto err = jdm.setAudioDeviceSetup(setup, true);
    dm.rescanWaveDeviceList(); // let Tracktion rebuild its wave-device wrappers for the new device
    if (err.isNotEmpty()) {
        // Combining separate in/out devices is a per-backend privilege, so put back what worked rather than leave a half-applied setup.
        warn("could not open audio device '" + name + "': " + err.toStdString());
        jdm.setAudioDeviceSetup(prev, true);
        if (!found->getTypeName().equalsIgnoreCase(prevType))
            jdm.setCurrentAudioDeviceType(prevType, true);
        dm.rescanWaveDeviceList();
        return false;
    }
    // The new device brings its own default buffer, so ask again — without this a switch silently moves the engine between quality bands.
    applyPreferredBufferSize(jdm);
    reconnectTrackInputs(armedBefore);
    if (!hasOut)
        std::cerr << "[audio] '" << name << "' is input-only — keeping output on '"
                  << setup.outputDeviceName << "'\n";
    return true;
}

void EngineHost::publishAudioTiming() {
    auto* dev = impl_->engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
    impl_->audioBufferFrames.store(dev ? dev->getCurrentBufferSizeSamples() : 0,
                                   std::memory_order_relaxed);
    impl_->audioSampleRate.store(dev ? dev->getCurrentSampleRate() : 0.0,
                                 std::memory_order_relaxed);
}

EngineHost::AudioTiming EngineHost::audioTiming() const {
    // What the interface COSTS, read from two ATOMICS rather than from the live device pointer, and 0 when nothing is open — docs/audioDevice.md.
    return {impl_->audioBufferFrames.load(std::memory_order_relaxed),
            impl_->audioSampleRate.load(std::memory_order_relaxed)};
}

EngineHost::CallbackCost EngineHost::callbackCost() const {
    // getCPUStatistics() loads one atomic the callback stored; the deadline comes from the SAME two atomics audioTiming reads, never the live device — docs/audioDevice.md.
    const auto s = impl_->engine.getDeviceManager().getCPUStatistics();
    const auto t = audioTiming();
    return {s.meanSeconds,
            s.maximumSeconds,
            s.minimumSeconds,
            static_cast<long long>(s.numRuns),
            t.sampleRate > 0.0 ? t.bufferFrames / t.sampleRate : 0.0};
}

void EngineHost::resetCallbackCost() {
    impl_->engine.getDeviceManager().restCPUStatistics();
}

// Reopen the OPEN device when its callback has stopped: the same device, never the remembered one — docs/audioDevice.md.
void EngineHost::checkAudioCallback() {
    auto& dm = impl_->engine.getDeviceManager();
    auto& jdm = dm.deviceManager;
    auto& watchdog = impl_->callbackWatchdog;
    auto* dev = jdm.getCurrentAudioDevice();
    const std::string name = dev != nullptr ? dev->getName().toStdString() : std::string{};

    switch (watchdog.check(dev != nullptr, callbackCost().runs)) {
        case CallbackWatchdog::Action::none:
            return;
        case CallbackWatchdog::Action::resumed:
            std::cerr << "[device] '" << name << "' is calling back again\n";
            return;
        case CallbackWatchdog::Action::giveUp:
            warn("audio interface '" + name + "' stopped processing audio and did not recover after " +
                 std::to_string(CallbackWatchdog::kMaxReopens) +
                 " reopens — make sure no other application holds it, then restart the engine");
            return;
        case CallbackWatchdog::Action::reopen:
            break;
    }

    warn("audio interface '" + name + "' stopped processing audio — reopening it (attempt " +
         std::to_string(watchdog.reopens()) + " of " + std::to_string(CallbackWatchdog::kMaxReopens) + ")");

    // What was armed, BEFORE the close: afterwards there is only the reopened device's empty arm flags to read.
    std::map<std::string, std::vector<std::string>> armedBefore;
    for (const auto& sid : impl_->ids())
        if (auto armed = armedTracks(sid); !armed.empty()) armedBefore[sid] = std::move(armed);

    jdm.closeAudioDevice();
    jdm.restartLastAudioDevice();   // from the setup JUCE holds, so nothing is re-chosen and nothing persisted
    dm.rescanWaveDeviceList();
    applyPreferredBufferSize(jdm);
    publishAudioTiming();
    reconnectTrackInputs(armedBefore);
    watchdog.reopened(callbackCost().runs);

    if (auto* now = jdm.getCurrentAudioDevice())
        std::cerr << "[device] '" << now->getName() << "' reopened: "
                  << now->getActiveInputChannels().countNumberOfSetBits() << " in, "
                  << now->getActiveOutputChannels().countNumberOfSetBits() << " out\n";
    else
        warn("audio interface '" + name + "' could not be reopened");
}

// Android only: a device that underran since the last check moves up ONE buffer size, up to kMaxXRunBufferMs — docs/android.md.
void EngineHost::checkXRuns() {
#if JUCE_ANDROID
    auto& dm = impl_->engine.getDeviceManager();
    auto& jdm = dm.deviceManager;
    auto* dev = jdm.getCurrentAudioDevice();
    if (dev == nullptr || !dev->isOpen()) {
        impl_->xruns = -1;
        return;
    }
    const int now = dev->getXRunCount();
    const int before = std::exchange(impl_->xruns, now);
    if (before < 0 || now <= before) return;

    const int current = dev->getCurrentBufferSizeSamples();
    const int cap = static_cast<int>(dev->getCurrentSampleRate() * kMaxXRunBufferMs / 1000.0);
    int next = 0;
    for (const int s : dev->getAvailableBufferSizes())
        if (s > current && (next == 0 || s < next)) next = s;
    if (next == 0 || next > cap) {
        if (!std::exchange(impl_->xrunsAtCap, true))
            std::cerr << "[audio] " << (now - before) << " underruns at " << current
                      << " frames, the largest buffer this engine asks for\n";
        return;
    }

    // What was armed, BEFORE the reopen a new buffer size costs: afterwards there is only the reopened device's empty arm flags to read.
    std::map<std::string, std::vector<std::string>> armedBefore;
    for (const auto& sid : impl_->ids())
        if (auto armed = armedTracks(sid); !armed.empty()) armedBefore[sid] = std::move(armed);

    auto setup = jdm.getAudioDeviceSetup();
    setup.bufferSize = next;
    const auto err = jdm.setAudioDeviceSetup(setup, true);
    dm.rescanWaveDeviceList();
    publishAudioTiming();
    reconnectTrackInputs(armedBefore);
    impl_->xruns = -1;   // a reopened stream counts from zero
    if (err.isNotEmpty())
        std::cerr << "[audio] " << (now - before) << " underruns, and the device refused " << next
                  << " frames: " << err << "\n";
    else
        std::cerr << "[audio] " << (now - before) << " underruns at " << current << " frames — buffer now "
                  << next << "\n";
#endif
}

std::string EngineHost::outputDeviceName() const {
    auto* dev = impl_->engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
    if (dev == nullptr) return {};
    // A device being OPEN is not being able to play: an input-only one opens happily with zero output channels, and the channels carry the callback.
    if (dev->getActiveOutputChannels().countNumberOfSetBits() == 0) return {};
    return dev->getName().toStdString();
}

// `--list-audio-devices`, deliberately standalone: a bare AudioDeviceManager enumerates without opening ANY device, which is what keeps it off a live ASIO driver.
int runAudioDevicesCli() {
    juce::ScopedJuceInitialiser_GUI juceInit;
    juce::AudioDeviceManager jdm; // getAvailableDeviceTypes() registers the backends lazily
    juce::Array<juce::var> arr;
    for (const auto& d : enumerateDevices(jdm)) {
        auto* o = new juce::DynamicObject();
        o->setProperty("name", juce::String(d.name));
        o->setProperty("type", juce::String(d.type));
        o->setProperty("inputs", d.inputs);
        o->setProperty("outputs", d.outputs);
        o->setProperty("current", d.current);
        o->setProperty("isDefault", d.isDefault);
        arr.add(juce::var(o));
    }
    auto* root = new juce::DynamicObject();
    root->setProperty("devices", juce::var(arr));

    std::cout << "\n" << kDevicesBegin << "\n"
              << juce::JSON::toString(juce::var(root)).toStdString() << "\n"
              << kDevicesEnd << std::endl;
    return 0;
}

}  // namespace studio
