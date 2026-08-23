# enginePlugin — the authoring → engine plugin mapping

`enginePlugin()` (project.ts) maps an AUTHORED module plugin
(`plugin: { type, name }` in module.yaml) to the `type` and `name` the engine's
`PluginDoc` wants. The two models differ, and both have to keep working.

## What the authoring model states

A **format**:

- `"internal"` — a built-in, its Tracktion xmlTypeName carried in `name`
  (e.g. `{type: "internal", name: "4osc"}`)
- an external format (`"vst3"`, `"au"`, …) — `name` is the plugin's real name, looked
  up in the engine's scan cache

## What the engine's wire format expects

Older, and narrower: `type` holds EITHER the built-in's xmlTypeName OR the external
format. So the mapping is:

| authored | engine `type` | engine `name` |
|---|---|---|
| `internal` | the xmlTypeName (from `name`) | the module's display name (`fallback`) |
| an external format | the format | the authored plugin name, else `fallback` |
| anything else (legacy) | passed through — already an xmlTypeName | the authored name, else `fallback` |

The legacy row is what lets a project authored before the `"internal"` model compile
unchanged, so no existing song needs migrating.

## The scan cache — engineCatalogue.ts

`~/.studio/exts.json` is a CONTRACT path: the C++ engine writes and reads the same file
(`PluginScan.cpp`'s `extsCacheFile()`). `engineCatalogue.ts` reads it so the engine's own modules
are read rather than copied into files.

**Empty means "we cannot say", not "nothing is installed".** A machine that has never run a scan
and a corrupt file both land there, and a caller that read it as "installed: none" would paint
every plugin in every project as missing. That is why `isPluginScanned` answers true when the cache
is empty: `format` is the authored `plugin.type` and `name` the plugin's real name, and the pair is
only judged absent against a cache that has something in it.

The read is memoised per FILE on the cache's mtime+size — the machine's cache is on the graph's hot
path, and a test points at a fixture instead, so one shared memo would make the two evict each
other. The plugins are sorted, so a map built from them is stable across runs: the order the scan
happened to write is not something a project's refs should depend on.

`ScannedPlugin.id` is JUCE's `fileOrIdentifier`, the one field that ADDRESSES a plugin rather than
describing it. Asking the engine to load one and list its parameters resolves this and not the
name, because two plugins can share a display name and only a path names one. Nothing that files or
draws a module needs it, which is why it went unread for as long as it did.

`engineModules()` keys every offered module by ref — the scanned plugins plus IN and OUT. Two rules
are worth stating:

- **`plugin.type` is the scanned FORMAT, lowercased, and nothing else.** `module populate` wrote
  `internal` whenever the role was "instrument", which mislabelled all forty VST3 instruments on
  this machine: a wrapper for one claimed to be a built-in, and the engine would have gone looking
  for a built-in by that name. Nothing hit it because the projects using those plugins declare them
  inline; the rule was simply wrong, and this is the one place it is now stated.
- **The ports are the TYPE's defaults and only those.** A scanned plugin has no file to declare
  ports in — what it really offers is the plugin's business, and the engine is what would know.

The ref and the plugin block both come from `moduleTypes.ts`, which is also what the médiathèque's
browser applies to the scan reported over the socket: one rule, so the two cannot spell the same
plugin differently. That vocabulary lives in the leaf with no filesystem so a BROWSER can name an
engine module without pulling `node:fs` in behind it, and it is re-exported from
`engineCatalogue.ts` because that is where every caller already looks. `IO_MODULES` moved for the
same reason plus one more: the BUILDER has to recognise `extends: "@engine/IN"` to know it is
editing an input, and it runs in a browser
([inputChannels.md](../../ui-module-builder/docs/inputChannels.md)).
