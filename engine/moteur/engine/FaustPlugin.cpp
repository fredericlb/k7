#include "FaustPlugin.h"
#include "Warnings.h"

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* FaustPlugin::xmlTypeName = "studio_faust";

juce::ValueTree FaustPlugin::create()
{
    juce::ValueTree v(te::IDs::PLUGIN);
    v.setProperty(te::IDs::type, xmlTypeName, nullptr);
    return v;
}

FaustPlugin::FaustPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    // The source, off the state — read HERE for the reason GraphDspPlugin reads its graph here: the parameters
    // a Faust program declares are the plugin's AutomatableParameters, and Tracktion creates those in the
    // constructor and never after. So the day a compiler is linked in, this is where it runs, and nothing
    // above this line changes.
    if (state.hasProperty("faust"))
        source_ = state.getProperty("faust").toString().toStdString();

    // Two different failures, said apart, because the fix is different for each.
    if (source_.empty())
        warn("faust module carries no source - is dsp.dsp missing from its folder?");
    else
        // Once per instance, and deliberately not silent: a module that draws, addresses its parameters and
        // plays its input unchanged is indistinguishable from one that is merely bypassed. That is the exact
        // shape of bug the compiler gate downstream already cost this repo once.
        warn("this engine is built without a Faust compiler - the module passes audio through unchanged "
             "(engine/moteur/docs/faust.md)");
}

FaustPlugin::~FaustPlugin()
{
    notifyListenersOfDeletion();
}

void FaustPlugin::initialise(const te::PluginInitialisationInfo&) {}
void FaustPlugin::deinitialise() {}
void FaustPlugin::reset() {}

void FaustPlugin::applyToBuffer(const te::PluginRenderContext&)
{
    // Pass-through: the buffer is already what it should be, so touching it is the one thing to avoid.
}

}  // namespace studio
