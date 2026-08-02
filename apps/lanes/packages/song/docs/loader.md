# loader.ts — extended notes

Background for the inline one-liners in `loader.ts`. Read that file first; come here
when a one-liner says "see docs/loader.md".

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
| `video_transitions` | video → video (the renderer treats consecutive placements as a crossfade pair across cuts) |

`midi` is kept as a LEGACY alias of `transformers` (the rename) so old `modules/midi/`
folders keep loading until their authors rename them on disk; `module create` proposes,
and the engine catalogue reports, `transformers`.

`kind` is `"io" | "plugin"` today; a `video_out` io module is still `kind: "io"`,
distinguished by its `io: "video_out"` field (analogous to `io: "out"|"in"`). The
`inputs[].type` union widens to include `"video"` so a video chain's typed-input check
(`checkChainInputs`) can refuse to feed a `video_effect` from an audio source and vice
versa.

`MODULE_EMITS` is not the same thing as a module's input: an `instruments` module takes
midi and gives back audio — that's the whole point of an instrument. A sink emits
nothing (`undefined`); an io `"in"` is a live audio source, handled at its use site
since both io roles share this one entry.

## Module instances

A module's folder holds a fixed `module.yaml` (the GENERIC module, referenced in chains
by the folder's name) and, optionally, one `<instance>.yaml` per INSTANCE — a specific
variant that inherits from `module.yaml` automatically. There is no `extends` to write;
the folder IS the parent. Chains reference an instance as `"<module>:<instance>"`:

```
modules/instruments/synth/module.yaml   ->  "synth"       (the generic)
modules/instruments/synth/lead.yaml     ->  "synth:lead"  (an instance)
modules/instruments/synth/pad.yaml      ->  "synth:pad"
```

An instance file is the same flat struct as `module.yaml` and is vetted the same way; it
normally states only what it CHANGES (a param, a rack symbol). It is merged UNDER the
generic with `mergeAuthored` — the same per-key merge an `extends` uses, and the reason
that merge has ONE definition (see moduleResolve.md) — so the effective module is:
extended base → `module.yaml` → instance.

One exception: `ui`. A UI describes the PLUGIN's controls, which every instance shares,
so it lives in `module.yaml` and is taken from there whole — the web module editor edits
that file for any instance you pick, and a `ui:` in an instance file has no effect.

## The asset library

A project points at shared folders (`project.libraries_from`; a workspace's is a sibling
`"../_library"`), each holding a subfolder per kind of asset — `ir/` for impulse
responses. A module names a file by its path INSIDE a library, so what a module says
stays short and survives being copied to another workspace: `ir: "ir/marshall.wav"`.

SEVERAL libraries are searched in declaration order, first hit wins — a song usually
wants its workspace's library AND one of its own, and with a single path the only way to
have both was to copy files into one of them.

This replaced discovery-by-convention (an audio file dropped in the module's own
folder). One cabinet IR is worth sharing across every module that wants it, and a folder
that held two audio files had no answer at all.

`resolveLibraryFile`: a path that climbs out of the library (`"../../etc/passwd"`) is
refused rather than resolved, since these come from files the editor writes and a shared
workspace may not be yours alone.

## `loadModules` internals

- **`raw`** tracks every module AS AUTHORED (pre-decoration) so `validatePlugins` checks
  what was actually written, not the loader's resolved copy.
- **`decorate`** adds the loader's fields (kind/inputs from the type folder, resolved
  preset/asset paths) to both the generic and each instance. The persisted plugin state
  is named after what it IS — `<name>.vstpreset` for the generic, `<instance>.vstpreset`
  for an instance — so a UI edit on one instance never overwrites the generic's blob or
  a sibling's; an instance with no blob of its own falls back to the generic's.
- **Instance merge**: each `<instance>.yaml` is vetted AS AUTHORED (the merged struct
  would re-report the generic's own problems on every instance), then merged under the
  generic. The generic's `ui` is taken WHOLE onto the merged result — a `ui:` in an
  instance file would otherwise half-merge into a grid the editor can't reach.
- **`validate`** defaults to `false` because the generator itself reads modules to BUILD
  the schema overlay (schemaGen/hints); validating there would make a project's modules
  unloadable whenever their own schema was stale, with no way back. The load paths that
  feed the engine (`loadGraph`, `compileNodeProject`) turn it on.

## Plugin validation rules

`KNOWN_PLUGIN_TYPES` must stay in step with `EXTERNAL_PLUGIN_FORMATS` (project.ts) and
the engine's `isExternalFormat`. `EXTERNAL_PLUGIN_FORMATS` itself has ONE definition —
`graphDoc.ts` re-exports project.ts's rather than restating it, which it used to. A `plugin.type` outside this set is either
`"not_supported"` (a deliberate marker — amber in the editor/graph) or UNKNOWN (a typo /
an unimported plugin — red); neither is a compile error, both are bypassed by the engine
and flagged visually instead.

The one rule that still BLOCKS the compile: a module whose plugin uses a KNOWN format
must name it (`plugin.name` — the xmlTypeName for `"internal"`, else the plugin's real
name). This is deliberately narrow — a mistyped format or an unimported plugin must not
take the whole project's timeline/chains down with it.

## Where a module's CATEGORY comes from

Not from a folder any more. `_modules` holds only what someone wrote — jsdsp and racks —
and the engine answers for everything it can load, so a plugin's type folder is derived
at read time by `categoryForRole` (moduleTypes.ts) off the `role` the scan reports.

The scan reports `role` (`instrument`/`midiEffect`/`audioEffect`) plus an `instrument`
boolean (JUCE's own `isInstrument`). An empty role becomes `"instrument"` only when
`isInstrument` is true, otherwise `"audioEffect"` — so a MIDI plugin JUCE does not tag
with `isInstrument` can land as `"audioEffect"` even when it really is an instrument
(Kontakt and other samplers). The boolean is checked as a fallback to rescue those into
`instruments/`, ahead of trusting `role=audioEffect`.

The per-plugin category the old file catalogue filed by (`Fx|Delay` → `audio/delay/…`,
plus a hand-kept override table for the plugins that misfiled themselves) is gone with
it: an engine ref is flat (`@engine/tape-delay`), and what groups it in a picker is the
module's own `category`, carried as data rather than parsed back out of a path.

