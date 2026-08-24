// pluginCache.ts — the engine's plugin SCAN CACHE, re-exported.
//
// The reader lives in `@studio/song/engineCatalogue`: the scan IS the module catalogue, so
// song has to read it to resolve `@engine/…`, and song cannot import this package
// (engine-client depends on song).
//
// Kept as a module so the two importers here don't have to care where it lives, and
// because "the plugin cache" is the name this side of the app knows it by.

export {
  isPluginScanned,
  type ScannedPlugin,
  scannedPluginKeys,
  scannedPluginNames,
  scannedPlugins,
} from "@studio/song/engineCatalogue";
