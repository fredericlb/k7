#pragma once

// The shared Tracktion/JUCE include and the aliases every internal TU uses — INTERNAL, so server/main.cpp must never include it and stays JUCE-free.

#include <tracktion_engine/tracktion_engine.h>

#include <filesystem>

namespace te = tracktion::engine;   // engine model: Engine, Edit, AudioFile, ClipPosition…
namespace tt = tracktion;           // core time types: TimePosition, TimeDuration, TimeRange, BeatPosition
namespace fs = std::filesystem;
