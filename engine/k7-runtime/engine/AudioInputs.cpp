// Mapping tracks onto live interface inputs — see AudioInputs.h.

#include "AudioInputs.h"

#include "EditBuilder.h"   // trackById (via findTrackInput)

namespace studio {

te::WaveInputDevice* findWaveInput(te::Engine& engine,
                                   const std::vector<int>& channels) {
    if (channels.empty()) return nullptr;
    for (auto* dev : engine.getDeviceManager().getWaveInputDevices()) {
        if (dev == nullptr) continue;
        const auto& devChannels = dev->getChannels();
        if (devChannels.size() != channels.size()) continue;
        bool match = true;
        for (size_t i = 0; i < channels.size(); ++i)
            if (devChannels[i].indexInDevice != channels[i] - 1) { match = false; break; }
        if (match) return dev;
    }
    return nullptr;
}

// The output mirror. Outputs default to STEREO pairs where inputs default to mono, so [3,4] usually matches — docs/cueOutput.md.
te::WaveOutputDevice* findWaveOutput(te::Engine& engine,
                                     const std::vector<int>& channels) {
    if (channels.empty()) return nullptr;
    auto& dm = engine.getDeviceManager();
    for (int i = 0; i < dm.getNumWaveOutDevices(); ++i) {
        auto* dev = dm.getWaveOutDevice(i);
        if (dev == nullptr) continue;
        const auto& devChannels = dev->getChannels();
        if (devChannels.size() != channels.size()) continue;
        bool match = true;
        for (size_t j = 0; j < channels.size(); ++j)
            if (devChannels[j].indexInDevice != channels[j] - 1) { match = false; break; }
        if (match) return dev;
    }
    return nullptr;
}

// Send one track out by its own pair instead of the mixer's sum — the whole of what a CUE bus is, docs/cueOutput.md.
void routeTrackOutput(te::Engine& engine, te::AudioTrack& track, const TrackDoc& t) {
    // Empty is the DEFAULT device, not "leave it alone": a track that stops being a cue bus has to rejoin the sum.
    if (t.outputChannels.empty()) {
        track.getOutput().setOutputToDefaultDevice(false);
        return;
    }
    auto* dev = findWaveOutput(engine, t.outputChannels);
    if (dev == nullptr) {
        // SILENT, never the sum: an id matching no device leaves canPlayAudio() false — docs/cueOutput.md.
        std::string want = "studio-absent-out:";
        for (size_t i = 0; i < t.outputChannels.size(); ++i)
            want += (i ? "+" : "") + std::to_string(t.outputChannels[i]);
        track.getOutput().setOutputToDeviceID(juce::String(want));
        std::cerr << "[output] track '" << t.id << "': no interface output on channel(s)";
        for (int ch : t.outputChannels) std::cerr << ' ' << ch;
        std::cerr << " — it is SILENT (never folded into the mix)\n";
        return;
    }
    if (!dev->isEnabled()) {
        // Enabling rebuilds the wave-device list and deletes this object, exactly as on the input side — docs/audioDevice.md.
        dev->setEnabled(true);
        engine.getDeviceManager().dispatchPendingUpdates();
        dev = findWaveOutput(engine, t.outputChannels);
        if (dev == nullptr) return;
    }
    track.getOutput().setOutputToDeviceID(dev->getDeviceID());
    std::cerr << "[output] track '" << t.id << "' -> '" << dev->getName() << "'\n";
}

te::InputDevice::MonitorMode monitorModeOf(const std::string& s) {
    if (s == "off") return te::InputDevice::MonitorMode::off;
    if (s == "on")  return te::InputDevice::MonitorMode::on;
    return te::InputDevice::MonitorMode::automatic;
}

// Tracktion holds the arm flag on the input's Destination, so there is no `armed` set of our own to keep in step — both sides need this same (track, instance) pair.
TrackInput findTrackInput(te::Edit* edit, te::Engine& engine, const ProjectDoc& doc,
                          const std::string& trackId) {
    if (edit == nullptr) return {};
    auto* track = trackById(*edit, trackId, doc);
    if (track == nullptr) return {};

    const TrackDoc* td = nullptr;
    for (const auto& t : doc.tracks)
        if (t.id == trackId) { td = &t; break; }
    if (td == nullptr || td->inputChannels.empty()) return {};

    auto* ctx = edit->getCurrentPlaybackContext();
    if (ctx == nullptr) return {};
    auto* dev = findWaveInput(engine, td->inputChannels);
    if (dev == nullptr) return {};
    auto* instance = ctx->getInputFor(dev);
    if (instance == nullptr) return {};
    return {track, instance};
}

}  // namespace studio
