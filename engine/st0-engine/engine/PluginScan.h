#pragma once

// The plugin-scan cache's in-process memo — INTERNAL header; the scan and the discovery CLIs live in PluginScan.cpp. See docs/plugins.md.

#include "EngineHost.h"   // PluginInfo
#include "EngineTypes.h"  // te::Engine

#include <memory>
#include <vector>

namespace studio {

/** The scan cache parsed once and reused, as a SHARED SNAPSHOT — hold it as long as anything into it, docs/plugins.md. */
std::shared_ptr<const std::vector<PluginInfo>> cachedPluginInfos();

/** Tracktion's built-ins plus ours, always available without scanning; `id` is each one's xmlTypeName. docs/plugins.md. */
std::vector<PluginInfo> builtInPlugins();

/** …and the AirWindows set, 186 of them, from the same X-macro that declares them — a SECOND list, docs/airWindowsList.md. */
std::vector<PluginInfo> airWindowsPlugins();

// Register the plugins st0 adds to Tracktion's own — ONE function, and every path that builds an Engine must call it (docs/plugins.md).
void registerBuiltInPlugins(te::Engine& engine);

// Drop the memo so the next read re-parses the cache — called once per apply (picking up a rescan) and after a scan rewrites the file.
void invalidatePluginInfoMemo();

}  // namespace studio
