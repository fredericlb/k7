#pragma once

// Mapping a track's declared live inputs onto the interface's wave-input devices. INTERNAL header, used by the
// recording path: applyTrackInput wires a track to its device, and setArmed/armedTracks/prepareTakes resolve
// the (track, instance) pair through findTrackInput.

#include "EngineTypes.h"
#include "ProjectDoc.h"

#include <string>
#include <vector>

namespace lanes {

// The wave input device carrying exactly `channels` (1-based, as the doc states them). Tracktion builds one
// device per mono channel or stereo pair, so an exact match is the only honest one: asking for [3,4] must not
// silently land on the mono device for channel 3. Null when the rig offers no such device — the usual case for
// a song written on another interface.
te::WaveInputDevice* findWaveInput(te::Engine& engine, const std::vector<int>& channels);

// Parse a monitor-mode string ("off"/"on"/anything else -> automatic).
te::InputDevice::MonitorMode monitorModeOf(const std::string& s);

// The engine track and its live input instance for a doc track. Null for every reason a track cannot be armed,
// so callers only have to distinguish "armable" from "not".
struct TrackInput {
    te::AudioTrack* track = nullptr;
    te::InputDeviceInstance* instance = nullptr;
};

TrackInput findTrackInput(te::Edit* edit, te::Engine& engine, const ProjectDoc& doc,
                          const std::string& trackId);

}  // namespace lanes
