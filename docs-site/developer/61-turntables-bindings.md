# Desk controls and bindings

A desk control moves a module parameter that the **project** names. Nothing about the desk is hard-wired to a module: `surfaces/<id>.yaml`'s `mapping:` joins control ids to graph nodes. This page covers the vocabulary, the join, and the mix project scaffold that writes the default mapping.

## The surface file

Schema: `packages/song-schema/src/yaml/surfaceSchema.ts`; reader: `packages/song-schema/src/yaml/surfaceFile.ts`; project-side listing and creation: `packages/song/src/surfaces.ts`.

- `type: turntables` must have `layout: split` (`SURFACE_LAYOUTS_BY_TYPE`).
- `playlist` and `stems` are refused on any other type (`superRefine`), rather than ignored.
- `mapping` is `MixViewSchema` itself (`packages/song-schema/src/yaml/mixViewSchema.ts`): a record of control id to `{ module, param, invert?, also? }` or `null`. Reusing the schema keeps the desk's older `views/mix.yaml` and the surface from drifting.
- `SURFACE_MAPPING_SKELETON.turntables` is what `project surface new turntables` writes, every control as `null` with a comment. It is a copy of the control list kept honest by `packages/k7-plugins/src/turntables/mapping.test.ts`.

`packages/song` validates the mapping's **shape** and deliberately not its ids; the desk owns its vocabulary.

## Control vocabulary

`packages/k7-plugins/src/turntables/controls.ts` defines `MIX_CONTROLS`, derived from `DECKS` so a third deck is not unbindable:

| Id | Kind | Range (from `deckVocabulary.ts`) | Home | `wants` |
|---|---|---|---|---|
| `crossfade` | fader | 0..1 | `MIX_CENTRE` 0.5 | crossfade |
| `deckX.tempo` | fader | `BPM_RANGE` 10..300 | 0 | tempo |
| `deckX.sync` | button | 0..1 | 0 | |
| `deckX.eqLow/eqMid/eqHigh` | fader | `EQ_DB` ±20 | 0 | eq |
| `deckX.cue` | button | 0..1 | 0 | cue |
| `deckX.filter` | fader | `FILTER_RANGE` ±100 | 0 | filter |
| `deckX.trim` | fader | `TRIM_DB` ±12 | 0 | trim |
| `deckX.level` | fader | `LEVEL_DB` −60..+6 | 0 | level |
| `deckX.echo` | fader | `ECHO_RANGE` 0..1 | 0 | echo |
| `deckX.stem{Drums,Bass,Other,Vocals}` | fader | `STEM_RANGE` 0..2 | `STEM_NEUTRAL` 1 | stem |
| `transport`, `listen` | button | 0..1 | 0 | |

Ranges are the **modules' own** knob ranges (their `ui.yaml`), so a binding cannot offer a range the panel refuses to draw. `wants` is a hint for scaffolding and is never checked.

`mapping.ts` lists `REQUIRED_CONTROLS`: `crossfade` plus each deck's `tempo`, `eqLow`, `eqMid`, `eqHigh`, `filter`, `trim`, `level`. `cue`, `echo` and the stems are optional: a desk without them is complete. `Turntables.tsx` gates on `unmappedControls(mapping)` and draws the list of missing controls instead of a desk whose knobs go nowhere.

## Resolving bindings

`mixBindings.ts` joins the mapping to the compiled graph through `@studio/ui-chains/bindings` (`resolveMapping`, `resolveTarget`, `stepsByModule`), the same join k7's mastering strip and MIDI maps use. What stays desk-specific:

- **`plugless: "track"`**: an `offline` module (the cold tempo) compiles to no plugin, so its binding resolves to the **track** its chain draws from. `stretchTargets` turns those into per-track tempos for the document; `offlinePublish` lends the graph both `Target BPM` and `Source BPM` through `deck.setModuleParam`.
- **`also`**: a second target resolved the same way; an unresolvable one is reported, never dropped.
- **`valueFor`**: `invert` mirrors within the control's own range first, then the widget's denormalisation (`widgetDenorm`) maps to the param, so `curve` and `step` are honoured.
- **`hasPlugin`** checks the **compiled document's** plugin ids (`enginePluginIds`), not the graph: a control is live only if the engine will actually have that plugin.
- **`leavesByItsOwnPair`**: the cue button is live only if the cue send's track has `outputChannels`, which the compiler gives the `CUE` bus only when the machine named a pair (`system cue`).
- **`controlDriving`**: the binding read backwards, for a no-plugin param turned in the graph (`useDeckSet.fromGraph`), with a 250 ms settle standing in for the release the graph does not report.

`BindingProblem`s are drawn on the desk by control.

## The mix project scaffold

`packages/song/src/scaffoldSet.ts` writes a new set (`setProjectFiles`, `scaffoldSet`); `packages/file-service/src/projectLifecycle.ts` maps the `mix` archetype to it. It is hand-authored like the other scaffolds because its `#` comments ship to disk as the worked example.

Per deck (`DECKS = ["deckA", "deckB"]`), `graphForDeck` writes:

```
deckA: [ platterA ]        platterA: [ tempoA ]      tempoA: [ trimA ]
stemDrumsA: [ platterDrumsA ]   platterDrumsA: [ trimA ]   (x4 stems)
trimA: [ eqA ]   eqA: [ filterA ]   filterA: [ levelA, cueA ]   cueA: [ CUE ]
levelA: [ echoA ]   echoA: [ fadeA ]   fadeA: [ MIX ]
MIX: [ OUT ]
```

Choices it encodes:

- **Five lanes per deck meet at the trim**, which makes the trim a bus head and the strip a chain of its own. The trim is first so it reaches stems and record alike.
- **Every source lane is `bypassed`** and each strip is `bus_only`: the lanes are heard through the bus only, otherwise a part would reach the master twice. The scaffold writes the reason above the key (`BUS_ONLY_NOTE`).
- **The crossfade is two `fade` modules**, one inverted by the mapping, because a module's second port is a sidechain and a deck feeding only a crossfade would also be heard raw.
- **The cue tap is after the filter and before the level** (pre-fade listen); **the echo is after the level** (echo-out).
- **Stem levels are the platter's own `Gain`** (`STEM_PARAM`), not a separate gain module.
- `assemblyFiles` writes `assemblies/turntable{A,B}.yaml` using `TURNTABLE_REF = "@k7-core/turntable"`; they draw a deck's nodes as one box and change nothing in the compiled document.

Node and control names are spelled once in `packages/song-schema/src/stems.ts` (`stemLane`, `stemPlatter`, `deckPlatter`, `stemControl`, `turntableMembers`), because the scaffold and the desk must agree and the desk cannot import a scaffold.

## Adding a control, end to end

1. Add the id to `MIX_CONTROLS` (`controls.ts`) with the module's real range.
2. Decide whether it is required (`mapping.ts`).
3. Add the `[id, note]` row to `SURFACE_MAPPING_SKELETON.turntables`.
4. Give the scaffold the node and the mapping line (`scaffoldSet.ts`), and a migration if existing sets need it.
5. Expose value, liveness and a setter in `useDeckSet` (most controls go through `pushParam`/`turn`), then draw it in a view.
6. Run `controls.test.ts`, `mapping.test.ts`, `mixBindings.test.ts` and `packages/song/src/scaffoldSet.test.ts`.
