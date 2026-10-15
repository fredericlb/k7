#include "SeekRelease.h"

#include "ArpeggiatorPlugin.h"
#include "FaustPlugin.h"
#include "GraphDspPlugin.h"
#include "MidiGraphPlugin.h"
#include "PatternPlugin.h"
#include "SfzPlugin.h"
#if STUDIO_SURGE
#include "SurgePlugin.h"
#endif
#include "eurorack/EurorackPlugin.h"

namespace te = tracktion::engine;

namespace studio {

namespace {

// External plugins are left to the VST; AirWindows have no reset() to call (docs/panic.md).
bool holdsNotesOrTail(te::Plugin* p)
{
    return dynamic_cast<te::ReverbPlugin*>(p) != nullptr || dynamic_cast<te::DelayPlugin*>(p) != nullptr
        || dynamic_cast<te::ImpulseResponsePlugin*>(p) != nullptr || dynamic_cast<te::FourOscPlugin*>(p) != nullptr
        || dynamic_cast<FaustPlugin*>(p) != nullptr || dynamic_cast<GraphDspPlugin*>(p) != nullptr
        || dynamic_cast<SfzPlugin*>(p) != nullptr || dynamic_cast<eurorack::EurorackPlugin*>(p) != nullptr
        || dynamic_cast<MidiGraphPlugin*>(p) != nullptr || dynamic_cast<ArpeggiatorPlugin*>(p) != nullptr
        || dynamic_cast<PatternPlugin*>(p) != nullptr
#if STUDIO_SURGE
        || dynamic_cast<SurgePlugin*>(p) != nullptr
#endif
        ;
}

}  // namespace

void releaseOnSeek(te::Edit& edit)
{
    for (auto* p : te::getAllPlugins(edit, false))
        if (holdsNotesOrTail(p)) {
            p->midiPanic();
            p->reset();
        }
}

}  // namespace studio
