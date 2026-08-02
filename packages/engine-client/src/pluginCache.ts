// pluginCache.ts — the engine's plugin SCAN CACHE, re-exported.
//
// The reader itself moved to `@studio/song/engineCatalogue`, because the scan is no
// longer only a way to say "this plugin is unknown before the engine fails to load it":
// it IS the module catalogue, replacing the folder of generated wrappers that `module
// populate` wrote into `_modules`. song has to read it to resolve `@engine/…`, and song
// cannot import this package (engine-client depends on song).
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
