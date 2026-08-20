# Curves — automation, and the three shapes of it

A curve is a normalised function of time in `curves/<id>.yaml`, bound to a module's parameter. It
has never had a page; the prose lived in `curves.ts`'s comments and in two half-contradicting notes
on the graph side. Two things now read it — a timeline row and `track automation add|remove` — so
it is worth saying once, here.

## The three types, and what each is a function OF

```yaml
# curves/sweep.yaml — a shape somebody DREW
type: custom
polarity: unipolar
points:
  - { time: "1:1:1", value: 0 }
  - { time: "2:1:1", value: 1 }
```

| type | a function of | positioned? |
|---|---|---|
| `custom` | **song time** — `points[].time` are absolute timecodes, `"1:1:1"` is the song's start | yes |
| `lfo` | its own period — `frequency` in **cycles per bar**, `phase` in 0..1 | no |
| `adsr` | **a note-on** — `attack`/`decay`/`sustain`/`release` in **milliseconds** | no |

That column decides almost everything downstream, and it is the one thing to hold on to:

- A `custom` curve is the only one a **timeline row can draw**, because it is the only one with
  positions to draw against. See `WebCurve.points`.
- A `custom` curve is the only one an **insert of time** has to move, for the same reason. An LFO
  is periodic and survives untouched — though its phase relative to everything after the cut
  changes, which is a fact about music, not a bug. See [insertTime.md](insertTime.md).
- An ADSR is fired by note-ons, so `sustain` is a **hold duration** rather than a level: a baked
  envelope has no note-off to wait for.

`polarity` is `unipolar` (0..1, the default) or `bipolar`, which remaps `v → 2v-1` at sample time.

## The binding lives on the MODULE

```yaml
# modules/instruments/synth/module.yaml
automations:
  - { param: "Filter Freq", curve: sweep }
```

**Keyed by param** — one knob, one curve. Binding a second replaces the first rather than stacking
lanes, which is what `setModuleAutomation` implements and what makes `param` a usable address.

`trigger` is an ADSR's only extra: which module's note-ons fire the envelope. Absent, it is the
module being automated.

## A track owns an automation because a MODULE is in its chain

There is no track-level automation field anywhere in the authoring model, and there should not be.
`ownerOf` in `nodeProject.ts` returns the chain's own name — and a track-fed run is named after its
lane — so an automation lands on a track purely because the automated module sits in that track's
chain. A chain that is neither track-fed nor a used bus owns nothing, and its automations are
dropped.

This is why `track automation add|remove <track> <param>` is a **view** rather than a second store:
it resolves the param against the track's chain and then writes through the very writer
`node automate` uses. Two verbs, one place a binding is written.

It is worth a verb of its own because an automation lane is reached from the LANE. Asking someone
which module in their chain owns "Filter Freq" before they can draw against it is asking them to
hold the graph in their head to edit the arrangement.

### What `add` creates

A **flat** `custom` curve — two points at the same value, at the song's start and its end — at
wherever the knob currently sits (`plugin.params[param]`, else the plugin's published default,
normalised against the param's range).

Flat and at that value because **binding a curve overrides its param the moment it is bound**. A
curve at the wrong height is an audible jump on a verb whose whole promise is to change nothing
yet. Where the value cannot be determined, the verb refuses rather than guessing.

Two points rather than the one the schema's `min(1)` would allow: a single point says nothing
about a slope and draws as a line with no visible end.

### What `remove` does not do

It unbinds, and **leaves the curve file**. An unbind is not a deletion; an unbound curve still
draws as its own card on the graph, so nothing is orphaned invisibly and rebinding is one verb.

## The bake, and what the engine gets

`bakeCurve` turns a curve into `AutomationDoc.points` — `[beat, output]` pairs in the curve's own
range, which the engine maps onto the param.

- `custom` emits its points **verbatim**, `parsePosition`'d and sorted. Nothing is sampled.
- `lfo` samples a grid at 24 breakpoints per bar, widened if it would pass 2048 points.
- `adsr` is `bakeAdsr`'s: five corner points per note-on, ms converted at the song tempo. A
  trigger arriving early **cuts** the running envelope at the value it had reached — lanes cannot
  sum. Coincident corners are nudged by 1e-6 beats rather than dropped, so a zero-length stage
  draws as the vertical step it is.

## What reaches the browser

Two documents carry two different halves, and neither carries the bake:

| | what | where |
|---|---|---|
| the binding | `{param, curve, trigger?}` per module step | `WebChainStep.automations` |
| the shape | `{type, shape?}`, **plus `points` for a `custom` curve** | `WebGraph.curves` |

`automationLanes()` in `@studio/graph-model` is the one place those are joined into a per-track
list, and both surfaces that need it read the result: the chains graph draws the binding as a mauve
arrow into the named param, the timeline draws the shape as a row under the lane.

**Not the baked points.** They exist only on the engine-bound `TrackDoc`, and an LFO baked at 24
points per bar would be thousands of numbers on a document the graph pane refetches on every
reload — to draw a figure its own card already names in two words. A row for an LFO or an ADSR
still appears, because the binding is real and worth seeing, and draws an empty line.

## Editing the shape: `curve point add|move|remove`

```
curve point add    sweep 5:1:1 0.8      # place one, or set the one already there
curve point move   sweep 5:1:1 7:1:1    # …keeping its value unless you give a new one
curve point remove sweep 5:1:1
```

Addressed by **time**, because a curve is a function of song time: two points cannot share a
moment, so the moment names one. `add` at a time that already has a point **sets** that point
rather than growing a twin — the same "one address, one value" rule a binding follows.

`value` is **0..1, the curve's own range**, not the param's. What it maps onto is the plugin's
business (`polarity` decides the output range, the engine maps it onto the knob), and one curve
may be bound to more than one knob over its life.

Two invariants, both properties of the file rather than of any one call:

- **The points stay in time order.** `bakeCurve` sorts regardless, so this is not about the sound
  — it is about the file being readable by eye. A writer that appended would scramble it within a
  minute of dragging.
- **A curve never runs out of points.** `parseCurve` refuses a custom curve with none, and a curve
  file the loader refuses takes the whole project down with it. So the LAST point cannot be
  removed; stopping the automation is `track automation remove`, which unbinds and leaves the
  curve where it is.

The timeline's automation row offers all three from its right-click, filled with the moment under
the pointer — snapped to a tick the ruler actually drew, so the grid you see and the moments a
point can land on cannot disagree.

## One thing that is not here yet

**A non-built-in's params.** `track automation add` resolves a param through `builtinParamsFor`, so
it reaches the engine's built-ins. A scanned VST's parameters are known to the engine but not to
that table; `node automate` takes them by name regardless.
