#pragma once

// The plugin-scan cache's in-process memo. INTERNAL header: the scan code and the public discovery CLIs live in
// PluginScan.cpp, and those CLIs are declared in the JUCE-free EngineHost.h because the server calls them.
// The only thing crossing TUs internally is this memo — the graph builder reads it per plugin, and applyFull
// and scanInstalledPlugins invalidate it.

#include "EngineHost.h"   // PluginInfo
#include "EngineTypes.h"  // te::Engine

#include <vector>

namespace lanes {

// The plugin scan cache parsed once and reused: makeExternalPlugin runs per plugin, and re-parsing the file
// each time added up on projects with many.
const std::vector<PluginInfo>& cachedPluginInfos();

// Register the plugins lanes adds to Tracktion's own: our two (the waveform tap, the Neural Amp Modeler) and
// the two Tracktion ships without registering (the convolver, the AirWindows set).
//
// ONE function, called by every path that builds an Engine — the live host, the offline renderer, the param dump.
// It used to live only in EngineHost's constructor, so a `--render` produced a mix with no amp modeller, no
// impulse response and no tap in it: an export that did not sound like what you had been listening to, and
// nothing said so beyond one "could not create plugin" line on stderr.
void registerBuiltInPlugins(te::Engine& engine);

// Drop the memo so the next read re-parses the cache. Called once per apply (picking up a rescan) and after a
// scan rewrites the file.
void invalidatePluginInfoMemo();

}  // namespace lanes
