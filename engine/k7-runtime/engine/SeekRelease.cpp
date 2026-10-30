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

#include <vector>

namespace te = tracktion::engine;

namespace studio {

namespace {

// Tracktion's own: they clear their buffers IN PLACE, so they are reset with the audio callback held off (docs/panic.md).
bool clearsInPlace(te::Plugin* p)
{
    return dynamic_cast<te::ReverbPlugin*>(p) != nullptr || dynamic_cast<te::DelayPlugin*>(p) != nullptr
        || dynamic_cast<te::ImpulseResponsePlugin*>(p) != nullptr || dynamic_cast<te::FourOscPlugin*>(p) != nullptr;
}

// External plugins are left to the VST; AirWindows have no reset() to call (docs/panic.md).
bool holdsNotesOrTail(te::Plugin* p)
{
    return clearsInPlace(p)
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
    std::vector<te::Plugin*> inPlace;
    for (auto* p : te::getAllPlugins(edit, false)) {
        if (!holdsNotesOrTail(p)) continue;
        if (clearsInPlace(p)) {
            inPlace.push_back(p);
            continue;
        }
        // Ours raise a flag the next block acts on, so they need no lock.
        p->midiPanic();
        p->reset();
    }
    if (inPlace.empty()) return;
    // The graph renders inside the device callback, so holding its lock means no block is running: a few memsets, never a wait on a plugin of ours.
    const juce::ScopedLock audio(edit.engine.getDeviceManager().deviceManager.getAudioCallbackLock());
    for (auto* p : inPlace) {
        p->midiPanic();
        p->reset();
    }
}

}  // namespace studio
