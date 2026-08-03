# The .dawproject import pipeline

Three modules, in order: `dawproject.ts` reads, `params.ts` enriches, `emit.ts` writes.

## `dawproject.ts` — the mapper

A `.dawproject` is a ZIP of `project.xml` (the song), `metadata.xml`, plus `audio/*` and
`plugins/*` assets. This module unzips the bytes in memory, parses `project.xml`, and
projects it onto lanes's song schema — the same shape `project.ts` reads back. It
performs NO disk I/O: it returns the song object plus every asset entry for the caller
to write out.

The mapping is deliberately lossy where lanes can't yet represent something (warps /
time-stretch, plugin state, automation): those are dropped, while the structural
essentials (tracks, params, audio clips, MIDI notes, plugin refs, sends) are carried so
a later phase can wire them.

## `params.ts` — plugin state → text params

A `.vstpreset` is an opaque blob; text params are diffable and live in the chain. This
module asks the engine to enumerate a plugin's parameters as `paramID -> value`, so
`emit.ts` can write chain params instead of a preset:

- **built-ins**: `studio-moteur --dump-params <type>`
- **externals**: `studio-moteur --dump-params-ext <format> <id> <statefile>`
  (instantiate the plugin, restore its `.vstpreset`, dump params)

The engine reports whether the params fully reproduce the state ("complete"); only then
is the opaque preset dropped. An external plugin is located in the lanes cache
(`~/.lanes/exts.json`) by name to get its format + identifier, and its state bytes
(from the archive) are written to a temp file for the engine.

The whole step is a no-op when the engine binary isn't found, so import still works
without a built engine — presets are kept then.

## `emit.ts` — the output layout

```
<outDir>/
  project.yaml                  header
  chains.yaml                   the graph: track -> modules -> OUT
  modules/io/OUT/module.yaml    the stereo-output sink (io module)
  modules/{instruments,audio,midi}/<slug>/module.yaml
                                self-contained modules, each its own folder filed by
                                type (the folder gives the kind + input port): the
                                plugin inline + its params; deduped by plugin+params
  tracks/<slug>.yaml            arrangement: positioned clips/sequences + settings
  clips/<id>.yaml (+.wav)       raw audio material
  sequences/<id>.yaml           raw MIDI material (inline notes)
  plugins/*.vstpreset           extracted plugin state (written beside each module)
```

No schema file: a project is validated in process against the loader's own schemas
(`packages/song/src/yaml/`), so there is nothing to ship alongside it.

### Mapping a DAWproject (track-based) onto the node model

- each source track becomes a `tracks/` arrangement;
- each plugin becomes a self-contained module (its plugin inline + params); the track's
  ordered plugin chain becomes chain `use` steps referencing those modules, instrument
  first then audio FX, routed to OUT;
- effect/return tracks become bus subbranch chains (no `from`), targeted by enabled
  sends (a source's terminal fans out to OUT + its send buses);
- the master track maps to OUT (or a master chain if it carries plugins).
