#include "BroadcastTapPlugin.h"

namespace lanes {

const char* BroadcastTapPlugin::xmlTypeName = "broadcastTap";

juce::ValueTree BroadcastTapPlugin::create()
{
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being lanes's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

}  // namespace lanes
