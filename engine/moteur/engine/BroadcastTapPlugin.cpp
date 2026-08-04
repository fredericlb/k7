#include "BroadcastTapPlugin.h"

namespace studio {

const char* BroadcastTapPlugin::xmlTypeName = "broadcastTap";

juce::ValueTree BroadcastTapPlugin::create()
{
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being l8's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

}  // namespace studio
