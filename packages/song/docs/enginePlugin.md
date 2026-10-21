# enginePlugin — the authoring → engine plugin mapping

`enginePlugin()` (project.ts) maps an AUTHORED module plugin
(`plugin: { type, name }` in module.k7x) to the `type` and `name` the engine's
`PluginDoc` wants. The two models differ, and both have to keep working.

## What the authoring model states

A **format**:

- `"internal"` — a built-in, its Tracktion xmlTypeName carried in `name`
  (e.g. `{type: "internal", name: "4osc"}`)
- an external format (`"vst3"`, `"au"`, …) — `name` is the plugin's real name, looked
  up in the engine's scan cache

## What the engine's wire format expects

Narrower: `type` holds EITHER the built-in's xmlTypeName OR the external format. So the
mapping is:

| authored | engine `type` | engine `name` |
|---|---|---|
| `internal` | the xmlTypeName (from `name`) | the module's display name (`fallback`) |
| an external format | the format | the authored plugin name, else `fallback` |
| anything else | passed through — already an xmlTypeName | the authored name, else `fallback` |

Both spellings are written on disk, which is what the third row is for: a module whose
`type` is already an xmlTypeName compiles unchanged, and no song needs migrating.

## `jsdsp` has TWO hosts, and the type FOLDER picks

`jsdsp` is what the author writes; the engine has no plugin of that name, so it loads a host and is
handed the compiled graph. Which host is not authored anywhere — it is what the module EMITS:

| the module's type folder | the host |
|---|---|
| `audio`, `instruments` … | `DSP Graph` (`studio_dspgraph`) |
| `transformers` (emits midi) | `MIDI Graph` (`studio_midigraph`) |

Tracktion routes the two differently and says so through the type — an audio effect sits after the
instrument, a MIDI one before it — so one plugin class cannot answer both, and something has to
choose. The type folder already says which a module is; making the author say it again in
`plugin:` would be a second answer, free to disagree with the first. `moduleEmits` is that one
answer, and `nodeProject.ts` is where it is asked.

The same holds for `faust`, whose host is `Faust` either way: a Faust program that takes MIDI is a
polyphonic INSTRUMENT, not a note effect, and `engine/k7-runtime/docs/faust.md` says how the
program itself declares that.

## The scan cache — engineCatalogue.ts

`<state>/exts.json` is a CONTRACT path: the C++ engine writes and reads the same file
(`PluginScan.cpp`'s `extsCacheFile()`). `engineCatalogue.ts` reads it so the engine's own modules
are read rather than copied into files.

**Empty means "we cannot say", not "nothing is installed".** A machine that has never run a scan
and a corrupt file both land there, and a caller that read it as "installed: none" would paint
every plugin in every project as missing. That is why `isPluginScanned` answers true when the cache
is empty: `format` is the authored `plugin.type` and `name` the plugin's real name, and the pair is
only judged absent against a cache that has something in it.

**While the scan cannot say, the built-ins stand in for it.** Every engine has them, so
`engineModules()` offers the generated table (`@studio/song-schema/builtinParams`) as the scan
would list them — `internal`, by display name and role — whenever the cache is empty. An account's
file service has no cache until an engine is bound to it (`packages/file-hub/binding.ts` writes it
then), and a project compiled before that — an open through the API, a fresh install on a computer — would
otherwise lose every `@engine/…` node, a Surge synth sent no patch. A scan that says something
replaces the table rather than adding to it: it is what THIS engine has, and a build without Surge
must not be sent one. Externals have no table, so they stay unknown until the scan lands.

**An account's copy is written by one function**, `writeScanCopy`: the hub on a binding, and again
when the scan running at the binding ends (`packages/file-hub/docs/fileHub.md`), and the account's
file service when a project held for the scan is released (`packages/file-service/docs/engineLoad.md`).
It writes the engine's `plugins` reply in the scan file's own shape, atomically, and leaves a copy
that already says the same alone: its mtime is in every project's revision token, and a rewrite
throws away the compile an open just made.

**Which projects wait for a scan is `namesExternalPlugin`** (`externalPlugins.ts`): a module whose
plugin is an external format, or an `extends` chain — or a chain step — that ends on an
`@engine/…` ref which is not a built-in. The unresolved ref is the case that matters: a plugin
installed since the last scan is exactly a ref the stale catalogue does not resolve. A built-in is
in the generated table, so a project of built-ins never waits. A project that cannot be read
answers false and opens as it would have, its own error reported where it always is.

The read is memoised per FILE on the cache's mtime+size — the machine's cache is on the graph's hot
path, and a test points at a fixture instead, so one shared memo would make the two evict each
other. The plugins are sorted, so a map built from them is stable across runs: the order the scan
happened to write is not something a project's refs should depend on.

`ScannedPlugin.id` is JUCE's `fileOrIdentifier`, the one field that ADDRESSES a plugin rather than
describing it. Asking the engine to load one and list its parameters resolves this and not the
name, because two plugins can share a display name and only a path names one. Nothing that files or
draws a module needs it.

`engineModules()` keys every offered module by ref — the scanned plugins, or the built-ins above; the io
roles are `ioModules()`. Two rules
are worth stating:

- **`plugin.type` is the scanned FORMAT, lowercased, and nothing else.** Writing `internal`
  because the role is "instrument" mislabels every VST3 instrument on the machine: a wrapper for
  one would claim to be a built-in, and the engine would go looking for a built-in by that name.
  This is the one place the rule is stated.
- **The ports are the TYPE's defaults and only those.** A scanned plugin has no file to declare
  ports in — what it really offers is the plugin's business, and the engine is what would know.

The ref and the plugin block both come from `moduleTypes.ts`, which is also what the médiathèque's
browser applies to the scan reported over the socket: one rule, so the two cannot spell the same
plugin differently. That vocabulary lives in the leaf with no filesystem so a BROWSER can name an
engine module without pulling `node:fs` in behind it, and it is re-exported from
`engineCatalogue.ts` because that is where every caller already looks. `IO_MODULES` sits there for
the same reason plus one more: the BUILDER has to recognise `extends: "@meta/IN"` to know it is
editing an input, and it runs in a browser
([inputChannels.md](../../ui-module-builder/docs/inputChannels.md)).
