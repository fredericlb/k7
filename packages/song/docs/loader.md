# loader.ts — extended notes

Background for the inline one-liners in `loader.ts` and the readers it re-exports —
`entities.ts`, `moduleTree.ts`, `moduleRefs.ts`, `moduleAssetFiles.ts`, `diagnostics.ts` and
`projectFiles.ts`. Callers import from `loader.ts`; the split is by what is read, so a reader of one
kind of file opens one module. Come here when a one-liner says "see docs/loader.md".

## Module type folders and `MODULE_EMITS`

A module's kind and input port are DERIVED from its type folder, so a module file only
carries its specifics (a plugin, a rack, `io: "out"/"in"/"video_out"`, or a video
effect's `type`):

| folder | signal |
|---|---|
| `io` | sink/source (no input) |
| `instruments` | midi → audio |
| `audio` | audio → audio |
| `transformers` | midi → midi |
| `video_effects` | video → video |
| `video_transitions` | two pictures → one, and **never wired**: a CUT names one (`fade_in: { over: 1, with: wipe }`), so it is material rather than a chain step ([transitions.md](../../song-video/docs/transitions.md)) |
| `shaders` | video → video, **plus an optional AUDIO input** — the one type whose ports carry two signals, because a shader is for a picture that moves with the sound ([shaders.md](../../song-video/docs/shaders.md)) |

`midi` is a LEGACY alias of `transformers`, so a `modules/midi/` folder on disk keeps
loading until its author renames it; `module create` proposes, and the engine catalogue
reports, `transformers`.

`kind` is `"io" | "plugin"`; a `video_out` io module is still `kind: "io"`,
distinguished by its `io: "video_out"` field (analogous to `io: "out"|"in"`). The
`inputs[].type` union includes `"video"` so a video chain's typed-input check
(`checkChainInputs`) can refuse to feed a `video_effect` from an audio source and vice
versa.

`MODULE_EMITS` is not the same thing as a module's input: an `instruments` module takes
midi and gives back audio — that's the whole point of an instrument. A sink emits
nothing (`undefined`); an io `"in"` is a live audio source, handled at its use site
since both io roles share this one entry.

## Module nodes

A module's folder holds one `module.yaml` and nothing else that is a module. A project's
USES of modules are files in a flat `nodes/` folder at its root, where the filename is
the node name and chains say that alone:

```
modules/instruments/synth/module.yaml   ->  "synth"   (the module)
nodes/lead.yaml                         ->  "lead"    (one use of it)
nodes/pad.yaml                          ->  "pad"     (another)
```

The full page is **`docs/nodes.md`** — where the type comes from when there is no
type folder, what lives beside a node, and why the folder is flat.

## The files a module loads

A module carries them, in an `assets/` folder of its own, and names one in `params:`
(`params: {model: jcm800.nam}`). `resolveAssets` resolves those against that folder and
nowhere else; `listModuleAssets` walks it for the panel's dropdown.

A path that climbs out of `assets/` is refused rather than resolved, since these come from
files the editor writes and a shared workspace may not be yours alone.

There is no shared asset library: the folder is the module, so what it loads travels with
it. See `docs/moduleAssets.md` for the whole of it.

## `loadModules` internals

- **`raw`** tracks every module AS AUTHORED (pre-decoration) so `validatePlugins` checks
  what was actually written, not the loader's resolved copy.
- **`decorate`** adds the loader's fields (kind/inputs from the type folder, resolved
  preset/asset paths) to a module. The persisted plugin state is `<name>.vstpreset` beside
  its `module.yaml`.
- **`loadNodes`** is the separate pass over `nodes/`, and it deliberately decorates
  LESS: no `kind`, `inputs` or `category`, because a flat folder has no type folder to read
  them off. Leaving them absent is what lets them arrive from what the node `extends`
  (see moduleResolve.md's `OWN_ONLY`). It sets `home` — the node's own folder — since
  `nodes/lead.vstpreset` does not follow from a category and a module name.
- **Name collisions** are reported, not resolved: a module and a node answering to one
  name would make a chain step ambiguous, so the module wins and the node is an issue.
- **`validate`** defaults to `false` because the generator itself reads modules to BUILD
  the schema overlay (schemaGen/hints); validating there would make a project's modules
  unloadable whenever their own schema was stale, with no way back. The load paths that
  feed the engine (`loadGraph`, `compileNodeProject`) turn it on. It is a judgement on what
  was READ, which is why the two flavours share one cache entry — see below.
- **The read is memoised**, here and in `loadModuleRefs`, on a stamp of the folders they walk.
  This is the expensive half of every compile and the half that changes least; a command in k7
  asks for it four to six times over. `docs/moduleCache.md` has the measurement, what the stamp
  covers, the two rules a caller has to keep — and the tempting variant that is wrong.

## Plugin validation rules

`KNOWN_PLUGIN_TYPES` must stay in step with `EXTERNAL_PLUGIN_FORMATS` (project.ts) and
the engine's `isExternalFormat`. `EXTERNAL_PLUGIN_FORMATS` itself has ONE definition —
`graphDoc.ts` re-exports project.ts's rather than restating it. A `plugin.type` outside this set is either
`"not_supported"` (a deliberate marker — amber in the editor/graph) or UNKNOWN (a typo /
an unimported plugin — red); neither is a compile error, both are bypassed by the engine
and flagged visually instead.

`jsdsp` and `faust` are in NEITHER set: they name no external binary and no built-in by its
xmlTypeName, so they are neither validated here nor bypassed. `dspSourceFor` reads them, and
`enginePlugin` maps each onto the built-in that hosts it — `docs/faustModules.md` has the pair
side by side, including the four gates a new plugin type has to be added to.

The one rule that still BLOCKS the compile: a module whose plugin uses a KNOWN format
must name it (`plugin.name` — the xmlTypeName for `"internal"`, else the plugin's real
name). This is deliberately narrow — a mistyped format or an unimported plugin must not
take the whole project's timeline/chains down with it.

## Where a module's CATEGORY comes from

Not from a folder. `_modules` holds only what someone wrote — jsdsp and racks —
and the engine answers for everything it can load, so a plugin's type folder is derived
at read time by `categoryForRole` (moduleTypes.ts) off the `role` the scan reports.

The scan reports `role` (`instrument`/`midiEffect`/`audioEffect`) plus an `instrument`
boolean (JUCE's own `isInstrument`). An empty role becomes `"instrument"` only when
`isInstrument` is true, otherwise `"audioEffect"` — so a MIDI plugin JUCE does not tag
with `isInstrument` can land as `"audioEffect"` even when it really is an instrument
(Kontakt and other samplers). The boolean is checked as a fallback to rescue those into
`instruments/`, ahead of trusting `role=audioEffect`.

An engine ref is **flat** (`@engine/tape-delay`), so nothing files a plugin under a path
of its own (`Fx|Delay` → `audio/delay/…`, plus a hand-kept override table for the plugins
that misfile themselves). What groups it in a picker is the module's own `category`,
carried as data rather than parsed back out of a path.

