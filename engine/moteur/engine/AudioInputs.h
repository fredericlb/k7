#pragma once

// Mapping a track's declared live inputs onto the interface's wave-input devices — an INTERNAL header, used by the recording path alone.

#include "EngineTypes.h"
#include "ProjectDoc.h"

#include <string>
#include <vector>

namespace studio {

// The wave input device carrying exactly `channels` (1-based), an exact match so [3,4] never lands on the mono device for 3, and null when the rig offers none.
te::WaveInputDevice* findWaveInput(te::Engine& engine, const std::vector<int>& channels);

// Parse a monitor-mode string ("off"/"on"/anything else -> automatic).
te::InputDevice::MonitorMode monitorModeOf(const std::string& s);

// The engine track and its live input instance for a doc track, null for every reason a track cannot be armed so callers only tell "armable" from "not".
struct TrackInput {
    te::AudioTrack* track = nullptr;
    te::InputDeviceInstance* instance = nullptr;
};

TrackInput findTrackInput(te::Edit* edit, te::Engine& engine, const ProjectDoc& doc,
                          const std::string& trackId);

}  // namespace studio
