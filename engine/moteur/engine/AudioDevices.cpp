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
constexpr int kPreferredBufferFrames = 512;

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
    int want = sizes[0];
    for (const int s : sizes) {
        const int d = std::abs(s - kPreferredBufferFrames);
        const int best = std::abs(want - kPreferredBufferFrames);
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
    if (want != kPreferredBufferFrames)
        std::cerr << " (nearest this device offers to " << kPreferredBufferFrames << ")";
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
