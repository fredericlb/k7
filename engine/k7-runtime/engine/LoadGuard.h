// LoadGuard.h — what the engine is LOADING, written down for as long as it loads it, so a crash inside a
// plugin's or a model's own code is pinned on that file at the next start and the file is then refused.
// The one thing a reader would get wrong: it is two strikes, not one — a kill or a power cut mid-load is
// one unfinished load too, so a file is QUARANTINED only after the engine died loading it twice. docs/crashes.md.

#pragma once

#include <juce_core/juce_core.h>

#include <string>

namespace studio {

/** `<state>`: $STUDIO_HOME, else ~/.k7 — the one spelling, shared with studioHome.ts (docs/plugins.md). */
juce::File studioStateDir();

/** Marks one load of `path` (a plugin binary, a model, an instrument) as in flight until destroyed. */
class LoadGuard {
public:
    LoadGuard(const std::string& kind, const std::string& path);
    ~LoadGuard();
    LoadGuard(const LoadGuard&) = delete;
    LoadGuard& operator=(const LoadGuard&) = delete;

private:
    juce::File marker_;
    std::string path_;
};

/** Turn on the marking, and judge what a previous engine left in flight; the server calls it once, before anything loads. */
void enableLoadGuards();

/** Whether `path` is refused; `why` then says so in words a person can act on. */
bool loadQuarantined(const std::string& path, std::string& why);

/** Whether safe mode refuses the external plugin `name`; `why` then says so (docs/crashes.md). */
bool safeModeRefuses(const std::string& name, std::string& why);

}  // namespace studio
