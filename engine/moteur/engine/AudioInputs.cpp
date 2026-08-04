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

te::InputDevice::MonitorMode monitorModeOf(const std::string& s) {
    if (s == "off") return te::InputDevice::MonitorMode::off;
    if (s == "on")  return te::InputDevice::MonitorMode::on;
    return te::InputDevice::MonitorMode::automatic;
}

// Tracktion holds the arm flag on the input's Destination, so there is no `armed` set of our own to keep in
// step: setArmed writes it there and armedTracks reads it back. Both need the same (track, instance) pair.
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
