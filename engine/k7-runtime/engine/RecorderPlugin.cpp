#include "RecorderPlugin.h"

namespace studio {

const char* RecorderPlugin::xmlTypeName = "studio_recorder";

juce::ValueTree RecorderPlugin::create()
{
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being k7's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

}  // namespace studio
