#pragma once

// The plugin-scan cache's in-process memo. INTERNAL header: the scan code and the public discovery CLIs live in
// PluginScan.cpp, and those CLIs are declared in the JUCE-free EngineHost.h because the server calls them.
// The only thing crossing TUs internally is this memo — the graph builder reads it per plugin, and applyFull
// and scanInstalledPlugins invalidate it.

#include "EngineHost.h"   // PluginInfo
#include "EngineTypes.h"  // te::Engine

#include <memory>
#include <vector>

namespace studio {

/**
 * The plugin scan cache parsed once and reused: makeExternalPlugin runs per plugin, and re-parsing
 * the file each time added up on projects with many.
 *
 * A SHARED SNAPSHOT, not a reference into a global. `scanInstalledPlugins` invalidates the memo
 * from a DETACHED thread while the message thread reads it, and makeExternalPlugin holds a raw
 * `const PluginInfo*` into the vector across a dozen lines — a background scan finishing mid-apply
 * therefore freed the buffer under it. Hold the returned pointer for as long as you hold anything
 * into what it points at, and a rescan lands on the next lookup instead of on this one.
 */
std::shared_ptr<const std::vector<PluginInfo>> cachedPluginInfos();

/**
 * Tracktion's built-ins plus ours, always available without scanning. `id` is each one's xmlTypeName,
 * which `createNewPlugin` accepts, so these round-trip straight to instantiation.
 *
 * Exposed for `--dump-builtin-params`, which has to instantiate every one of them to read its parameters
 * out. A second copy of the list would be exactly the drift the note above `registerBuiltInPlugins`
 * already warns about — a plugin a project can name and nothing knows the parameters of.
 */
std::vector<PluginInfo> builtInPlugins();

/**
 * …and the AirWindows set, 186 of them, from the same X-macro that declares them.
 *
 * A SECOND list rather than part of the one above because they are registered separately and
 * come from a third party's header — but everything that asks "what can this engine create
 * without scanning" wants both, which `cachedPluginInfos` already concatenates. Exposed for the
 * same reason: `--dump-builtin-params` walked only the first, so `@engine/chorus-ensemble` and
 * 185 siblings had no parameters and therefore no panel.
 */
std::vector<PluginInfo> airWindowsPlugins();

// Register the plugins st0 adds to Tracktion's own: our two (the waveform tap, the Neural Amp Modeler) and
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

}  // namespace studio
