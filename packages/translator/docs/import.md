# The import pipeline

Four modules. `model.ts` holds the neutral shape; **one mapper per foreign format** reads
into it (`dawproject.ts`, `ableton.ts`); then `params.ts` enriches and `emit.ts` writes.

```
.dawproject ─┐
             ├─► Translation {song, files, stats, warnings} ─► params.ts ─► emit.ts
.als ────────┘
```

Only the mappers know a format. Everything downstream is format-blind, which is the whole
reason adding Ableton cost one file rather than a second pipeline.

## `model.ts` — the neutral shape

`Song`/`TrackOut`/`ClipOut`/`PluginOut`/`WarpOut`, plus the `Translation` a mapper returns.
It lives apart from any mapper on purpose: these types used to sit in `dawproject.ts`, and
a second importer reaching into a first one's file for the shared model is a lie about
where the boundary is.

Every mapper obeys the same contract: **no disk I/O**. It returns the song plus asset
bytes, and the caller writes them. A `.dawproject` carries its audio inside the archive; a
`.als` does not, so `parseAls` takes a `readSample` callback instead of opening files
itself — the contract holds either way.

## `dawproject.ts` — the mapper

A `.dawproject` is a ZIP of `project.xml` (the song), `metadata.xml`, plus `audio/*` and
`plugins/*` assets. This module unzips the bytes in memory, parses `project.xml`, and
projects it onto l8's song schema — the same shape `project.ts` reads back. It
performs NO disk I/O: it returns the song object plus every asset entry for the caller
to write out.

The mapping is deliberately lossy where l8 can't yet represent something (warps /
time-stretch, plugin state, automation): those are dropped, while the structural
essentials (tracks, params, audio clips, MIDI notes, plugin refs, sends) are carried so
a later phase can wire them.

## `ableton.ts` — the .als mapper

A `.als` is **gzipped XML**, one `<Ableton><LiveSet>` document, no container and no
embedded assets. Unlike DAWproject it has no spec: the schema is Live's own, undocumented,
and it drifts between versions. What follows is what a real Live 12.4 set actually
contained — each line is here because getting it wrong fails *silently*.

### The readings that bite

| | Live writes | what it means |
|---|---|---|
| master track | `<MainTrack>` in 12, `<MasterTrack>` in 11 | both are accepted; the rename is the single biggest 11→12 break |
| time signature | one packed integer on the main mixer — `201` | `num = v%99+1`, `den = 2**(v/99)`, so 201 is 4/4. `RemoteableTimeSignature` exists but only *inside a clip* |
| mute | `<Speaker>` where `true` = **audible** | `mute` is its inverse |
| pan | −1..1 | the model wants 0..1 |
| MIDI pitch | on the enclosing `<KeyTrack>`, not the event | the event carries only time/duration/velocity |
| clip position | audio under `MainSequencer/**Sample**/…`, MIDI under `MainSequencer/**ClipTimeable**/…` | no fixed path works; the mapper walks the track instead |

### Two that are worth their own paragraph

**An unwarped clip's region is in SECONDS.** Live puts the region in the same `<Loop>`
fields whether the clip is warped or not, and only `IsWarped` says which timeline it is in:
beats when warped, seconds when not. At 110 bpm that is a factor of 110/60 — every unwarped
clip lands 1.83× off, in a way that looks like a plausible arrangement rather than a bug.
Measured across a real set, the ratio is exact.

**`<Loop>` holds two different things depending on the brace.** With the loop ON, playback
starts at `StartRelative` and `LoopStart`/`LoopEnd` is a brace around the whole clip (often
0..244 for a clip that plays eight beats). With it OFF, `LoopStart`/`LoopEnd` *is* the
region and `StartRelative` is 0. Reading only one of them misplaces about half the clips in
a real arrangement. The loop brace is deliberately not passed on to `materialWindow`: a
full-clip brace would slice the window from 0 and drop every note.

Warp markers, by contrast, are a gift — `<WarpMarker BeatTime SecTime>` is already the
model's `[timeline beat, source second]` pair.

### What it carries, and what it cannot

Carried: tempo, signature, sample rate (off the first `SampleRef`), tracks with
volume/pan/mute, arrangement clips with warps, MIDI notes at full fidelity, and VST2/VST3/AU
plugins with their state blob — including plugins nested inside a **rack**, since an
Instrument Rack wrapping a VST is ordinary.

Not carried, each reported by name in the import log rather than dropped quietly: Live's own
devices (`Eq8`, `Operator`, `Roar`… have no portable form), the rack structure itself, sends
and return tracks, group tracks, Session view clips, and track colours (Live stores a palette
index, and the palette changed between 11 and 12).

Two traps worth naming. `<FileRef>` appears under samples, under device presets (`.adv`,
`.adg`) **and under VST binaries** — a real set held three strangers' home directories and a
`Program Files` DLL path — so only `SampleRef/FileRef` is treated as audio. And Live's
`<Buffer>` hex is wrapped across indented lines, so everything non-hex is stripped before
decoding.

### Samples live outside the file

A `.als` references audio by path, and `RelativePath` is **empty** unless the set went
through Live's *Collect All and Save*; what is always there is an absolute path from
whatever machine wrote it. Following those would let a crafted `.als` read any file on the
engine's machine, so the file service resolves **only** the relative path, and only through
`safePath` (see `packages/file-service/src/projectLifecycle.ts`).

The consequence is deliberate and must stay visible: an uncollected set imports its whole
structure and **no audio**. The import log says so in its own line, naming the fix, because
an import that lands silent is otherwise unexplainable.

## `params.ts` — plugin state → text params

A `.vstpreset` is an opaque blob; text params are diffable and live in the chain. This
module asks the engine to enumerate a plugin's parameters as `paramID -> value`, so
`emit.ts` can write chain params instead of a preset:

- **built-ins**: `studio-moteur --dump-params <type>`
- **externals**: `studio-moteur --dump-params-ext <format> <id> <statefile>`
  (instantiate the plugin, restore its `.vstpreset`, dump params)

The engine reports whether the params fully reproduce the state ("complete"); only then
is the opaque preset dropped. An external plugin is located in the l8 cache
(`~/.studio/exts.json`) by name to get its format + identifier, and its state bytes
(from the archive) are written to a temp file for the engine.

The whole step is a no-op when the engine binary isn't found, so import still works
without a built engine — presets are kept then.

**Live's blobs do not survive this step**, and that is expected rather than a bug to chase:
what a `.als` stores is the plugin's *raw* state (Arturia's is `boost::serialization`), not
a `.vstpreset` container, so the engine loads nothing and reports no params. Measured
against a real set, all three plugins came back empty and kept their preset — which is the
normal degraded path, not a failure. `ableton.ts` does seed the named parameters Live
exposes to automation, but they are only ever a subset (384 of a plugin's 2276), so
`paramsComplete` is never set and `emit.ts` correctly prefers the preset over partials.
Those params matter only for a plugin whose blob would not decode at all.

## `emit.ts` — the output layout

```
<outDir>/
  project.yaml                  header
  chains.yaml                   the graph: track -> modules -> OUT
  modules/io/OUT/module.yaml    the stereo-output sink (io module)
  modules/{instruments,audio,transformers}/<slug>/module.yaml
                                self-contained modules, each its own folder filed by
                                type (the folder gives the kind + input port): the
                                plugin inline + its params; deduped by plugin+params
  nodes/<slug>.yaml             a LANE: `extends` a track module, plus its placements
  nodes/<module>_<lane>.yaml    one USE of a plugin used more than once: `extends` the
                                module above and holds only what this use changes
  nodes/<node>.vstpreset        that use's own plugin state, beside its file
  clips/<id>.yaml (+.wav)       raw audio material
  sequences/<id>.yaml           raw MIDI material (inline notes)
```

Nodes are **flat**, and a chain step names one by its filename alone — never
`<module>:<node>`, the layout [nodes.md](../../song/docs/nodes.md) dropped. A plugin used
exactly once keeps its settings in `module.yaml` and gets no node file at all.

No schema file: a project is validated in process against the loader's own schemas
(`packages/song/src/yaml/`), so there is nothing to ship alongside it.

### Mapping a DAWproject (track-based) onto the node model

- each source track becomes a `nodes/` lane carrying its arrangement;
- each plugin becomes a self-contained module (its plugin inline + params); the track's
  ordered plugin chain becomes chain `use` steps referencing those modules, instrument
  first then audio FX, routed to OUT;
- effect/return tracks become bus subbranch chains (no `from`), targeted by enabled
  sends (a source's terminal fans out to OUT + its send buses);
- the master track maps to OUT (or a master chain if it carries plugins).
