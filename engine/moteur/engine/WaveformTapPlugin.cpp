#include "WaveformTapPlugin.h"

namespace studio {

const char* WaveformTapPlugin::xmlTypeName = "waveformTap";

juce::ValueTree WaveformTapPlugin::create()
{
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being st0's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

}  // namespace studio
