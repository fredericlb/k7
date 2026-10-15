// SeekRelease.h — what a seek during playback does to the plugins: notes let go AND tails cleared.
// The one thing a reader would get wrong: it is a LIST, not every plugin — a deck, a recorder or an amp has no tail to end (docs/panic.md).

#pragma once

#include <tracktion_engine/tracktion_engine.h>

namespace studio {

/** Message thread, right after the playhead moved while playing: midiPanic() and reset() on every plugin that holds a note or a tail. */
void releaseOnSeek(tracktion::engine::Edit&);

}  // namespace studio
