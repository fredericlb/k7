// MessagePump.h — spin JUCE's message loop for a while, where a process may. On Android it may not:
// JUCE forces JUCE_MODAL_LOOPS_PERMITTED to 0 there, because the loop IS the app's Looper, so this is a
// no-op and every caller is a CLI mode Android never runs, or EngineHost::run, which returns at once.
// See docs/android.md.

#pragma once

#include <juce_events/juce_events.h>

namespace studio {

/** Dispatch messages for up to `ms`; false once the loop was stopped, or always where no loop may be spun. */
inline bool pumpMessages(int ms) {
#if JUCE_MODAL_LOOPS_PERMITTED
    return juce::MessageManager::getInstance()->runDispatchLoopUntil(ms);
#else
    juce::ignoreUnused(ms);
    return false;
#endif
}

}  // namespace studio
