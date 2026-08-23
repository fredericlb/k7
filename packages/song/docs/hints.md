# hints — the completion vocabulary of a project

`hints.ts` gathers a project's entities into one `Hints` record: what the editor completes, what
it turns into a link, and what the note editors need to relabel a sequence. Every gather is
wrapped in `safe()` so a broken project degrades to whatever loaded — completion on a
half-written file is exactly when you need it.

## What each field holds, and why it is shaped that way

**`modules`** — the chain `use` vocabulary: a module's bare name for the generic `module.yaml`,
plus `"<name>:<node>"` for each `<node>.yaml` beside it (loader.ts's `NODE_SEP`), then the
inherited modules by ref (`@ns/type/name`).

Hidden ones are dropped and favourites come first, off the module's own `status:` — the only
thing that field does (`moduleTypes`' `MODULE_STATUSES`). Applied HERE rather than in the editor,
so the command bar and the YAML pane cannot come to offer two different lists. Read off the
AUTHORED module: a base being hidden is a statement about the base, and a module extending it has
its own answer or takes the default.

**`chains`** — the names the chains DERIVE to, not the names written in `graph.yaml`: a track's id
for a run it feeds, a module's name for a run that starts at it (see chainsGraph.ts).

**`channels`** — input-channel labels from the MACHINE's preferences, not the project. An io `in`
module's `channel` names one of these (`preferences.resolveInput`).

**`videoTracks`** — `video_tracks/<id>.yaml` ids, what an audio track's `video_source` may name to
inherit that track's placements and play their audio. Read schema-free like everything else here:
a project with a broken video track should still complete its audio ones.

**`audioClips` / `videoClips`** — the clips split by kind so the generated overlays can keep the
two references apart: an audio track (and any chain source) may name only an audioClip, a video
track only a videoClip. Without the split an audio track could reference an `.mp4` and it would
silently compile into a Tracktion audio clip.

**`moduleAssets`** — what each module's file-valued params may be set to: its own `assets/`
walked, as assets-relative paths (`Two-Rock/Clean.nam`), keyed by the chain `use` ref. What the
panel's dropdown offers, and what a `node param <node> nam …` is checked against. One with none is
absent rather than empty. Per module, because a module carries the files it loads — there is no
project-wide library to list any more. Its ancestors' assets count too: a thin local module
extending a shared amp carries none of its own, and offering nothing there is what made the
picker open empty. One walk covers every module — see `assetLookup`.

**`paramMetaByBase`** — what the params of a base SPAN, for the bases whose plugin is a built-in
we define (`builtinParams.ts`). Only a plugin knows its own range, and a widget bound without one
is drawn 0..1 — wrong for a -60..+6 dB fader. Absent for everything else: an external plugin
reports its ranges live, and that report wins where it exists.

**`racks`** — rack modules mapped to their effective (base+module) rack, keyed by the chain `use`
ref, so a node appears under its own `"<name>:<node>"` key with its own symbol overrides. Lets the
note editors relabel notes as symbols (and enter by symbol) when a sequence names the module via
`use_rack`, and — for a slice rack — draw the source clip's waveform with each symbol's
`[from,to]` window. Resolved first, so a module that inherits its flavour, its source or half its
symbols reports the whole thing.

**`keywords`** — the words YAML itself gives meaning to, offered so they can be completed rather
than mistyped. `on`/`off`/`yes`/`no` are the ones that bite: YAML 1.1 read them as booleans, so a
plugin called "on" has to be quoted.

**`pluginNames`** — scanned plugin names grouped by format (lowercased key), e.g.
`{ vst3: ["Serum"], au: ["Massive"] }`. Populated by the file service from the engine's scan cache
(`~/.studio/exts.json`); the brain's `projectHints()` returns an empty record.

**`media`** — every audio file in the project, grouped by its project-relative folder (`""` = the
root), filenames only. So a rack's `source:` (or a samples symbol's `clip:`) completes against the
audio sitting beside it. A shallow raw-fs walk of names, separate from the entity gathers because
these files aren't entities: they live beside them.

## The sinks list

`ioSinks` is sinks only. An io module is one unless it declares itself a source (`io: "in"`, a
live interface input); a source is not somewhere a chain can route TO, so leaving it in would
offer `out: ["IN"]` as a valid target.

The two BUILT-IN outputs come first and always. Neither is a module on disk, so neither appears in
`moduleRefs` — and a completion list that offered every declared sink but not `MIX`, where every
lane actually ends, would be a vocabulary missing its commonest word. `MIX` is the mixer's sum,
`OUT` the device; the run between them is the master chain (docs/masterChain.md).

The picture's pair follows them, and ONLY on a project that has picture: `RENDER` and `VIDEO_OUT`
are written onto a project with a viewport and onto no other, so offering `VIDEO_OUT` to a song
with no frame would complete a name that would then fail to resolve. See docs/videoOutputs.md.

`sharedRefs` — the inherited modules a chain node may name — is namespaced only: a LOCAL module is
already offered by its bare name, and listing it twice under two spellings is noise. io is IN
here, since an `in` module is a step (it feeds the chain it sits in) and an `out` one is what the
last node names. `@engine` is OUT: the plugin scan is browsed in the Libraries tab, not completed
here, or a rig's whole vendor catalogue buries the handful of modules the song has (`isEngineRef`
says why). It remains the vocabulary for `extends:`, which `baseRefs` answers — a chain step
naming one stays legal and stays typable, it is simply not suggested.

## Per-base params: three sources, one pass

`paramsByBase` is what the plugin DEFINES, then the base module's own defaults, then any overrides
on modules that extend it or are nodes of it.

The first source is the only complete one. The other two are learned from what somebody wrote
down, so a built-in nobody has authored a param on yet — the mixer, on the day it shipped — has an
empty bind list and no panel can be built for it.

Nodes count, and they arrive as ORDINARY extenders: one use of `mixer` is a file in `nodes/` that
extends it. Leaving them out meant every param on every strip in a real song was invisible here.

### `byExtends` — the index that replaced a nested loop

`byExtends` maps each base ref to what its extenders have written on it, built once in one pass.

This was a scan of every module INSIDE the loop over every base ref, with a fresh
`Object.values(modules)` per turn. On `01.danse.st0` that is 573 base refs × 395 modules — 226 000
comparisons and 573 allocations of the same array — and it was most of the 55 ms `/hints` costs,
paid after every command in the app.

A node needs no case of its own: it names what it uses with `extends`, like any other extender.
Both spellings of a LOCAL ref land in the same bucket — a project's own module answers to the bare
`<category>/<file>` and to `@project/<category>/<file>`, and new files write the second (see
`loadModuleRefs`). A namespaced ref (`@st0/…`) has no second spelling and is kept whole, which is
what the old `=== ref` arm did for it.

The ref is normalised on the way IN too. `loadModuleRefs` registers a local module under both
spellings, so `baseRefs` holds `audio/amp` AND `@project/audio/amp`; folding only the module side
left the second one reading an empty bucket — 238 entries where there were 239, which is exactly
the kind of off-by-one a rewrite of a nested loop is for.

## `paths` — turning a reference into a link

`"kind:name"` → the project-relative file that defines the entity, so the editor can turn a known
reference into a link. `kind ∈ module|base|sink|track|clip|sequence|chain` (chains all live in
`graph.yaml`). Derived by the folder conventions (`modules/<type>/`, `tracks/`, …) and only kept
when the file actually exists, so external `@ns/…` modules are skipped. Both `.yaml` and `.yml`
are tried and the one on disk wins.

`"module:"` keys by the chain `use` ref and points at the file that IS that thing: a module is
`modules/<type>/<name>/module.yaml`, a node is `nodes/<name>.yaml`. A node carries its own folder
in `home` precisely because it is no longer under the module it uses. `"base:"` keys by
`"type/name"` — an `extends` ref, always a module.

For a base, the FIRST segment is the type and the rest is the name, filing included: a module may
sit at `modules/audio/amps/neural-amp-modeler/`, so destructuring two segments sent "go to this
module" at the category folder — a path with no `module.yaml` in it.

The `@project/` spelling is aliased to the same entry. It is the SAME module — `loadModuleRefs`
registers both, and a real file's `extends` may use either — and without the alias a ctrl-click
and the popin's module pane go blind on exactly the files written the explicit way.
