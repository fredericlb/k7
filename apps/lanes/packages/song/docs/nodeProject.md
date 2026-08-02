# nodeProject.ts — extended notes

Compiles a chains/modules node project into the flat `ProjectDoc` the engine plays.

A node project (`project.yaml` + `chains.yaml` + `modules/` + tracks/clips/sequences)
is a graph: chains route a track `from` through modules (`use`) to the OUT sink. A
module carries a plugin (or io, or a rack) and params, and may `extends` another module
to inherit its defaults. The engine consumes the flat
tracks-with-clips-and-plugins model, so the compiler flattens:

- each track → a `ProjectDoc` track (placements → audio clips / MIDI notes)
- a chain `{ from: track, use: [{module}] }` → that module's plugin on the track, with
  params = the extended module's defaults merged with the module's overrides

## The reference pass — what fails loudly, and what doesn't

Unresolved references fail the compile rather than being silently dropped:

| reference | rule |
|---|---|
| a chain step's `module` | MAY be missing (skipped — see below); when it resolves, its `extends` must too |
| a module's `extends` | optional, but when NAMED it must resolve (a stub base still counts — it exists, it just has no plugin) |
| a placement's `ref` | must be a clip or a sequence; an audio clip's backing `.wav` must exist (a sequence is inline) |

A step naming a module the project doesn't have is deliberately NOT fatal: it compiles
to nothing, exactly like a bypassed step, and the signal passes through. Failing there
meant one dangling name — a renamed folder, a song opened without the workspace it
borrows its modules from — cost you the whole project rather than one node. `graph.ts`'s
`validate()` warns about it and the graph draws it as a `?`.

## Chain ownership: tracks and buses

A chain OWNS a track: a track-fed chain (`from` a real track) processes that track; any
*other* chain referenced as a send target is a bus, materialized as its own return track
named after the chain.

A chain's `use` steps become the owner track's plugins, in order. The OUT/io sink is the
dry main output, and every other `out` target becomes a weighted send (gain → level)
into the destination bus.

Buses materialized are the non-sink targets naming another chain that isn't itself
track-fed — a track-fed target would mean routing into a track's input, which the flat
model can't express yet, so those sends are dropped.

## Racks

A rack instrument compiles to a SamplerPlugin. The module arrives RESOLVED — the base's
symbols already merged under its own (see moduleResolve.md) — and `resolvedRack` reads the
flavour, the shared source and the symbols off it. Two flavours, unified into the engine's
`(clip, start, length)` sound shape:

- **samples** — each symbol names its own clip → `(clipAbs, 0, 0 = natural)`
- **slice** — all symbols share the rack's `source` file, windowed `[from, to)` →
  `(sourceAbs, from, to - from)`

Clip/source ids resolve to absolute paths like a placement's audio source; a dangling id
can't reach here (`loadModules(validate)` already pinned them to real audio-clip ids).
Checked BEFORE the `plugin.type` read, since a rack module carries no `plugin`.

## Preset resolution

The module's own `<name>.vstpreset` wins, else the extended module's. `presetSave` is
always the module's OWN path (inside its folder, where a UI edit is written) — the
extended module's preset is never overwritten.

The FOLDER is named by the module and the blob by what the step IS: an instance
(`"synth:lead"`) saves to `lead.vstpreset` beside its own `lead.yaml`, so tweaking one
instance never overwrites the generic's state or a sibling instance's.
