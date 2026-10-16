# Curves — automation, and the three shapes of it

A curve is a normalised function of time in `curves/<id>.yaml`, bound to a module's parameter.
Two things read it — a timeline row and `track automation add|remove` — so it is said once, here,
rather than in `curves.ts`'s comments and again on the graph side.

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
  - { param: "Filter Freq", curve: "@meta/curves/sweep" }
```

`curve` is a **namespaced ref**, `@meta/curves/<id>`, even though the file it names is a plain
`curves/<id>.yaml` beside the project — every module ref is namespaced, and a curve binding is no
exception. The `curve` commands (`curve new`, `curve point add|move|remove`) and `node automate`'s
own `<curve>` argument still take the **bare id**; only the value written into `automations:` carries
the `@meta/curves/` prefix, added when the binding is written and stripped back off when it is read.

**Keyed by param** — one knob, one curve. Binding a second replaces the first rather than stacking
lanes, which is what `setModuleAutomation` implements and what makes `param` a usable address.

`trigger` is an ADSR's only extra: which module's note-ons fire the envelope. Absent, it is the
module being automated.

## A track owns an automation because a MODULE is in its chain

There is no track-level automation field anywhere in the authoring model, and there should not be.
`ownerOf` in `compile/ownership.ts` returns the chain's own name — and a track-fed run is named after its
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

### Details of the bake

`adsrUnit` is written as a function of ELAPSED time rather than of song position, because that is
what an envelope IS: the trigger decides where it starts, and the function decides nothing but its
shape. All four ADSR stages are durations, sustain included (`AdsrCurveSchema` says why a baked
envelope cannot hold until a note-off it will never be told about); `level` is where decay lands and
sustain holds, and it is the only value that is not a time.

`sampleCurve` answers **0** for an ADSR. It has no value at a song position, only at a time since a
trigger, which that signature knows nothing about — untriggered is silent, and `bakeAdsr` is what
places it against the events. `bakeCurve` likewise emits a flat 0 for one, which keeps it total over
the union.

`bakeAdsr` emits five points per trigger — the corners of the shape — because the engine
interpolates between breakpoints and every stage is a straight line; sampling on a grid would be
both coarser and larger. A trigger arriving before the last envelope has finished CUTS it: the
running shape is held at the value it had reached, then the new one starts from 0 at its own
instant. One automation lane is one parameter and one parameter has one value, so the two cannot
sum. (A per-VOICE envelope, where overlapping notes each keep their own, is what the plugin's own
matrix does and what this deliberately is not.) The cut is taken at the value the shape had actually
reached, so the line into it is the envelope's own rather than a shortcut from the corner before,
and a corner strictly past the next trigger is what triggers it — an envelope ENDING exactly where
the next starts has nothing left to cut.

**A coincident corner is NUDGED past the beat, never dropped.** A zero-length stage puts two
corners on one beat, so dropping one makes an instant attack swallow the point before it — which,
where one envelope's release meets the next one's trigger, is the release's own landing: the ramp
down vanishes and the parameter simply stays up. A vertical pair a microbeat apart IS what an
instant stage looks like, and the engine interpolates it as the step it is. Coincident AND the same
value is the one case dropped: it says nothing the point before it did not — two zero-length stages
in a row, or one envelope ending where the next begins.

An ADSR's stages each default to 0 but the level: an envelope with no times written is an instant
spike, which is a legible thing to see and fix. A missing LEVEL is not — it would mean a decay to
silence and a sustain that holds nothing.

## What reaches the browser

Two documents carry two different halves, and neither carries the bake:

| | what | where |
|---|---|---|
| the binding | `{param, curve, trigger?}` per module step | `WebChainStep.automations` |
| the shape | `{type, shape?}`, **plus `points` for a `custom` curve**, and `spec`, the whole definition | `WebGraph.curves` |

`automationLanes()` in `@studio/graph-model` is the one place those are joined into a per-track
list, and both surfaces that need it read the result: the chains graph draws the binding as a mauve
arrow into the named param, the timeline draws the shape as a row under the lane.

**Not the baked points.** They exist only on the engine-bound `TrackDoc`, and an LFO baked at 24
points per bar would be thousands of numbers on a document the graph pane refetches on every
reload — to draw a figure its own card already names in two words. A row for an LFO or an ADSR
still appears, because the binding is real and worth seeing, and draws an empty line.

`spec` is every field of the curve with its defaults filled (`CurveSpec`, `@studio/graph-model`): what
the curve editor opens on, so editing a curve needs no second fetch of its file.

## Amplitude, and the arithmetic in one place

Every kind of curve takes `amplitude`, 0..1 and 1 by default: it scales the output, so a unipolar
curve sweeps 0..amplitude and a bipolar one rides ±amplitude around 0. It is applied once, where the
unit value leaves the curve (`curveOutput`), after polarity — for an envelope at each corner the bake
writes. One field for all three kinds, because how FAR a curve moves its knob is a question every
curve answers the same way, and an LFO with no depth is half an LFO.

## Duration

An oscillator may take `duration`, a 0-based timecode (`"2:0"` is two bars; `"0"`, the default and
never written, is for ever). It runs that long from its own start — the song's, or the run's when a
condition restarts it — so a retriggered LFO plays for `duration` at each restart. Past it the bake
writes nothing and the engine holds where it stopped, the same rule as outside a condition's window:
a duration is a run cut short, and is baked as one (`bakeConditioned`). Only oscillators take one: a
drawn curve already ends at its last point, and an envelope at its release.

## Cut

`cut` keeps one half of the output: `positive` clamps it to [0,1], `negative` to [-1,0], `none` (the
default, never written) keeps it whole. It applies after amplitude and polarity, in `curveOutput`, so
it is a fact about what LEAVES the curve rather than about its shape — a bipolar LFO cut positive
pushes its knob up from where it sits and never below. An on/off curve takes none: 0 and 1 have no
half to drop.

The bake does not clamp each sample. It bakes the whole curve and then cuts the breakpoints
(`cutPoints`), adding one where a segment crosses 0: the engine draws a straight line between
breakpoints, so a clamped endpoint alone would make the cut start at the next point rather than at the
crossing — a drawn ramp from -1 to +1 would rise from its first point instead of from its middle.

The arithmetic — an oscillator's wave, an envelope's shape, a drawn curve's interpolation, amplitude
and polarity — is `@studio/song-schema`'s `curveMath.ts`, with no fs, and `curves.ts` bakes through it.
The browser's curve editor previews through it too, so what it draws is what the bake plays.

## On/off: a boolean param's curve

`type: onoff` is drawn points like a custom curve with two differences, both because what it drives
is a SWITCH: every value is 0 or 1 (the schema refuses anything between, `parseCurve` rounds a stray
one, `curve point add` snaps), and a point HOLDS until the next rather than ramping to it
(`heldUnit` in `curveMath.ts`). The bake writes each change twice — the old value a microbeat before
it, the new one on it — so the engine, which interpolates between breakpoints, steps. It takes no
`amplitude` and no `polarity`: a switch has neither depth nor sign, so it is unipolar at full height.

A param's kind decides the curves it may follow: a boolean one (the curve editor reads that off the
control bound to it, a toggle or a button) follows an on/off curve and nothing else; a number any
other. That is the editor's rule rather than the file's — a curve does not know what it is bound to.

## Conditions

A curve may say WHEN it runs (`conditions`, a list): from a moment (`start`), until one (`end`),
between two (`between`), or from an event of the node it drives (`event`). The engine is told nothing
about them: they are applied where the curve is baked into breakpoints (`curveConditions.ts`), as the
amplitude is, so an engine that plays a breakpoint list plays a conditioned curve unchanged.

**Conditions are OR'ed: the curve runs while ANY of them holds.** That is what a list of WHENs means
when written by hand — "during the intro and again from the last chorus" — and an AND is already
spelt by the one condition that needs it, `between`. Where two stretches overlap they are one,
carrying the time of the one that started first; a stretch that RETRIGGERS takes over where it starts,
which is the rule below applied across conditions rather than within one.

A condition becomes the STRETCHES of song time the curve is sampled over, each with the beat its own
time counts from. Outside every stretch the bake writes nothing, so the engine holds the value at the
nearest edge: before a start, the curve's first value there; after an end, its last. That is "the
automation starts / ends here" without a value invented for the time it does not run.

**`retrigger` is one rule for every kind: the curve restarts the moment its condition comes true.**
A `start` or `between` without it carries on as if it had run since the song's start, so an LFO is in
the phase it would have been; with it, the stretch begins the curve's own time. On an `event`, without
it the FIRST event starts the curve and it runs on; with it, every event restarts it — the next
stretch begins a microbeat after the last ends, so the jump is a step and not a slope.

**An event is a note-on, for now.** It is the one event the compile can place in song time (the
node's lane's notes, the triggers an envelope already used), so `event` accepts that name however it
is spelt (`isNoteOnEvent`) and any other name never comes: the curve never starts. The name is free
text so the file says what was meant once a node announces more.

**An envelope keeps its triggers**, filtered by the conditions and pooled: a window keeps the note-ons
inside it and cuts an envelope it fired where it closes, and `retrigger` fires it at the window's
opening too. Two conditions firing on one beat are one firing, with the longer window.
Without `retrigger` a note landing while the envelope runs is IGNORED; with it — and with no condition,
which is what an envelope always did — it cuts the running one and starts again.

## The two scaffolds

`createCurveFile` writes an **LFO**, because it is the shape with useful defaults: a `custom` curve
with no points is not a curve at all, and one invented for you would be a guess about the song. A
sine at one cycle per bar is immediately audible once bound, which is what tells you the binding
worked.

`createFlatCurveFile` writes the **custom** one `track automation add` starts from — two points at
the same value, at the song's start and at `endTc`, so the lane is a horizontal line you can grab
rather than a single dot that says nothing about a slope. Custom rather than an LFO because this one
is going to be EDITED: an LFO is a shape you parameterise, a custom curve is a shape you draw, and a
lane on the timeline is the second. `value` is the param's CURRENT normalised position and it is the
caller's business to know it — which is why there is no default to fall back on.

Both REFUSE rather than overwrite: a curve someone is already using is not a thing to silently
replace, and the caller wants to know the name is taken. The filename IS the id, so it has to be one
a path and a reference can both carry.

`writeCurveFile` is the third writer, and the one that DOES replace: `curve set <name> <json>`, the
curve editor's Save, writes a curve whole from its fields, creating it or overwriting it. Replacing is
the point there — the editor holds every field, so the file is what it shows — and the fields are
held to the schema and read back through `parseCurve` before anything is written, so a curve this
writes is one the compile reads. Keys are written in a fixed order per kind, one point a line.

`editCurveFile` is the seam `curve point add|move|remove` acts through. A transform returning null
means "nothing was there at that address", which the caller reports by name; returning the text
unchanged writes nothing, so a no-op edit stays out of the journal exactly as a drag that ends where
it started does.

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
