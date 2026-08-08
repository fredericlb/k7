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

// The same sentinel trick as the plugin scan: JUCE and the audio drivers print to stdout while scanning, so the
// CLI fences its JSON. Kept in step with the brain's config reader.
constexpr const char* kDevicesBegin = "STUDIO_DEVICES_BEGIN";
constexpr const char* kDevicesEnd = "STUDIO_DEVICES_END";

// ASIO first: on Windows it is the low-latency path, and the same interface is usually offered by the other
// backends too — those are the fallbacks, so they sort below it.
int deviceTypeRank(const juce::String& t) {
    if (t.containsIgnoreCase("ASIO")) return 0;
    if (t.containsIgnoreCase("Windows Audio") || t.containsIgnoreCase("WASAPI")) return 1;
    if (t.containsIgnoreCase("DirectSound")) return 2;
    return 3;
}

/**
 * Ask every device we open for this, in frames.
 *
 * It decides the engine's quality band, and the band decides what you can DO here: a browser
 * reads 2 × buffer / rate as the audio half of the link's latency (a block in, a block out) and
 * adds its measured round trip — under 20 ms is playable, see packages/web-protocol/docs/quality.md.
 * At 48 kHz, 256 frames is 10.7 ms and leaves room for the network; the 480 a Windows endpoint
 * hands out by default is 20 ms on its own, which lands the machine in front of you in Q2.
 *
 * A PREFERENCE, not a promise: applyPreferredBufferSize takes the nearest size the device offers,
 * and some drivers (ASIO especially) own this setting outright. The engine reports what it really
 * got — `whoami` reads the open device — so the number on screen is never this constant.
 */
constexpr int kPreferredBufferFrames = 256;

// Enumerate the interfaces the backends offer, ASIO first, ONE row per name: Windows exposes the same endpoint
// under WASAPI shared/exclusive/low-latency AND DirectSound, which is three or four identical rows per device.
// ASIO is not lost to the dedup — its driver names differ from the WASAPI endpoint names, so it stays its own
// row. Channel counts are known only for the open device; the rest would have to be opened to answer.
std::vector<AudioDeviceInfo> enumerateDevices(juce::AudioDeviceManager& jdm) {
    std::vector<AudioDeviceInfo> out;
    auto* cur = jdm.getCurrentAudioDevice();
    const juce::String curName = cur != nullptr ? cur->getName() : juce::String();
    const juce::String curType = cur != nullptr ? cur->getTypeName() : juce::String();

    for (auto* type : jdm.getAvailableDeviceTypes()) {
        if (type == nullptr) continue;
        type->scanForDevices(); // required before getDeviceNames()
        const juce::String typeName = type->getTypeName();

        // Outputs first, then any input-only device: getDefaultDeviceIndex(false) indexes the OUTPUT list, which is
        // this array's prefix, so the appended input-only names can't be mistaken for the default.
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

    // Collapse the same interface offered by several Windows backends to a single row: the sort put the best-ranked
    // type first, so keep the first occurrence of each name. The running device's `current` is carried onto the kept
    // row even when the engine is on a collapsed variant, so the picker still checks the right interface.
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

/**
 * Move the open device to kPreferredBufferFrames, or to the nearest size it offers.
 *
 * Ties go to the LARGER size: too small drops out, and a dropout is a worse failure than a
 * millisecond. Silent when the device has no say (an empty list means the driver decides) and
 * warning-free when it refuses — a device that keeps its own buffer is working correctly, and the
 * quality badge simply shows what it costs.
 */
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

// Open a specific interface (input + output); `type` is the backend, and empty means the first one offering the
// name. Returns false and warns — never crashes — when it isn't among the enumerated devices.
bool EngineHost::setAudioDevice(const std::string& name, const std::string& type) {
    auto& dm = impl_->engine.getDeviceManager();
    auto& jdm = dm.deviceManager;
    const juce::String wanted(name);
    const juce::String wantedType(type);

    // Already there: say so and touch nothing. Not an optimisation — the file service re-asserts
    // the machine's remembered interface on EVERY reconnect, and doing the work below for a device
    // that never changed would re-wire the live inputs of a rolling session for nothing (and, on
    // ASIO, close and reopen a single-client driver under it).
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

    // Switch backend FIRST: setAudioDeviceSetup() only considers the current type, so an ASIO device is invisible
    // while Windows Audio is selected.
    const auto prevType = jdm.getCurrentAudioDeviceType();
    if (!found->getTypeName().equalsIgnoreCase(prevType))
        jdm.setCurrentAudioDeviceType(found->getTypeName(), true);

    // Only name a direction the device actually HAS, and never blank out one it doesn't: most interfaces carry
    // both, but a mic is input-only, and writing an empty name is not "leave it alone" — it REMOVES it.
    // Clearing the input is survivable; clearing the OUTPUT is not, since with nowhere to play there is no audio
    // callback, so the transport reports playing while nothing moves and no error appears anywhere. Picking the
    // built-in mic used to do exactly that, and the setup is persisted, so it stayed broken across restarts.
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

    // What was armed, BEFORE the switch — reading it afterwards would read the new device's
    // (empty) arm flags. See below for why it has to be put back by hand.
    std::map<std::string, std::vector<std::string>> armedBefore;
    for (const auto& sid : impl_->ids())
        if (auto armed = armedTracks(sid); !armed.empty()) armedBefore[sid] = std::move(armed);

    const auto err = jdm.setAudioDeviceSetup(setup, true);
    dm.rescanWaveDeviceList(); // let Tracktion rebuild its wave-device wrappers for the new device
    if (err.isNotEmpty()) {
        // Combining separate in/out devices is a per-backend privilege, so keeping the other direction can be what
        // failed. Put back what worked rather than leave the engine on a half-applied setup.
        warn("could not open audio device '" + name + "': " + err.toStdString());
        jdm.setAudioDeviceSetup(prev, true);
        if (!found->getTypeName().equalsIgnoreCase(prevType))
            jdm.setCurrentAudioDeviceType(prevType, true);
        dm.rescanWaveDeviceList();
        return false;
    }
    // The new device brings its own default buffer, so ask again: without this, switching
    // interface silently moved the engine between quality bands.
    applyPreferredBufferSize(jdm);
    reconnectTrackInputs(armedBefore);
    if (!hasOut)
        std::cerr << "[audio] '" << name << "' is input-only — keeping output on '"
                  << setup.outputDeviceName << "'\n";
    return true;
}

EngineHost::AudioTiming EngineHost::audioTiming() const {
    // What the interface COSTS, for the browsers to band a link into Q1/Q2/Q3 — see
    // packages/web-protocol/quality.ts. Reported rather than computed here because only the
    // device knows it, and it changes whenever one is opened or its buffer is changed.
    //
    // Zeros when nothing is open. That is not "instant": a client reads a zero as "not
    // measured" and says so, rather than crediting an engine with a latency nobody proved.
    auto* dev = impl_->engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
    if (dev == nullptr) return {};
    return {dev->getCurrentBufferSizeSamples(), dev->getCurrentSampleRate()};
}

std::string EngineHost::outputDeviceName() const {
    auto* dev = impl_->engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
    if (dev == nullptr) return {};
    // A device being OPEN is not the same as being able to play: an input-only one opens happily with zero output
    // channels, and it is the channels that carry the audio callback. Ask what actually matters.
    if (dev->getActiveOutputChannels().countNumberOfSetBits() == 0) return {};
    return dev->getName().toStdString();
}

// `--list-audio-devices`, deliberately standalone: a bare AudioDeviceManager is enough to enumerate, so this
// needs no running engine and never opens a device — which matters for ASIO, whose drivers are typically
// exclusive and would be stolen from an engine that is already playing.
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
