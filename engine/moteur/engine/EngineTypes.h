#pragma once

// The shared Tracktion/JUCE include plus the namespace aliases every internal engine TU uses. INTERNAL header:
// it pulls in Tracktion/JUCE, so server/main.cpp must never include it — the server compiles against the
// JUCE-free EngineHost.h only. One home for the aliases, so they can't drift between the split TUs.

#include <tracktion_engine/tracktion_engine.h>

#include <filesystem>

namespace te = tracktion::engine;   // engine model: Engine, Edit, AudioFile, ClipPosition…
namespace tt = tracktion;           // core time types: TimePosition, TimeDuration, TimeRange, BeatPosition
namespace fs = std::filesystem;
