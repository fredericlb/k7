# The desk's controls, and how to bind one to a parameter

Nothing on this desk is hard-wired. Each control carries an identifier, and what it MOVES is
written in the project — repointing one line of `views/mix.yaml` is enough to send the left fader
to the right deck.

`controls.ts` gives every control an identifier; the per-deck ones are DERIVED from the decks, so
a third deck cannot be silently impossible to bind.

| id | what | range |
|---|---|---|
| `crossfade` | the crossfader | 0..1 |
| `deckA.tempo`, `deckB.tempo` | a deck's tempo fader | 10..300 (the module's knob) |
| `deckA.sync`, `deckB.sync` | a deck's SYNC button | 0..1 |
| `deckA.eqLow`, `deckB.eqLow` | a deck's low band | −20..+20 dB |
| `deckA.eqMid`, `deckB.eqMid` | the mid | −20..+20 dB |
| `deckA.eqHigh`, `deckB.eqHigh` | the high | −20..+20 dB |
| `deckA.filter`, `deckB.filter` | the sweep filter | −100..+100 |
| `deckA.trim`, `deckB.trim` | input gain, at the head of the strip | −12..+12 dB |
| `deckA.level`, `deckB.level` | the **channel fader** — not the crossfader | −60..+6 dB |
| `deckA.echo`, `deckB.echo` | the echo, the only effect beyond the filter | 0..1 |
| `deckA.cue`, `deckB.cue` | the deck in the headphones, before the crossfader | 0..1 |
| `deckA.stemDrums`, `deckB.stemDrums` | the drums you REMOVE from the record | 0..1 |
| `deckA.stemBass`, … | bass, other, vocals — one control each | 0..1 |
| `transport` | play / stop | 0..1 |
| `listen` | listen in this tab | 0..1 |

The four stems are **offered without being required**, and so are cue and echo
([fx.md](fx.md)) — a desk that wires none of them is a complete desk. A track may never have been
separated, and a machine may have only one output pair ([cue.md](cue.md)). Each stem names its OWN
module (`cutBassA`), where the three EQ bands share theirs — a cut is a negative gain on the lane
playing that stem. See [stems.md](stems.md).

Trim and channel fader, by contrast, are **required**: without them the crossfader is the desk's
only level control, and that is precisely the state `REQUIRED_CONTROLS` exists to stop a surface
shipping. See [mix.md](mix.md).

The three EQ bands are in **decibels**, the filter in percent of travel, and all are symmetric so
that neutral falls in the middle: see [eq.md](eq.md) and [filter.md](filter.md).

The bindings themselves are in the **project**: `views/mix.yaml`, described in
[packages/song/docs/viewBindings.md](../../../../packages/song/docs/viewBindings.md).

## Why not the module's `controller.yaml`

`controller.yaml` belongs to a **module** and is shared by all its nodes. A set puts a `tempo`
module on **each** deck: one map for both, so a line cannot say "deck A's fader drives deck A's
stretch".

A CC is a property of the device you plugged in; which fader on YOUR desk moves THIS set's
crossfade is a property of the set. Two different questions, two files.

That is also why the ids are **absolute** — `deckA.tempo` rather than a relative `deck.tempo` to
resolve: the project file names `tempoA` and `tempoB` on separate lines, so there is nothing left
to resolve.

## The range, and why it is declared here

A binding has to turn "where this control is" into "what this parameter is worth". The only way to
do that without inventing a scale is to **normalise the control into 0..1** and let the target
widget's `min`/`max` unroll it — exactly the trip a CC's 0..127 already makes in st0's
`useMidiControl`. A control that did not declare its range would force every consumer to guess
one.

It is also why `deckA.tempo` carries the **module knob's** range (10..300) and not one of its own:
a binding must not be able to ask for a tempo the panel refuses to draw.

### `widgetDenorm` unrolls it, not an interpolation written here

The second half of the trip belongs to `@studio/ui-chains/graph`. Written by hand —
`min + unit × (max − min)` — it is only correct for a **linear widget with no `step`**: a
`curve: log` parameter moved from the desk would land somewhere other than the same parameter
moved on the graph, in the same app and on the same plugin. So st0 and the desk both call the
shared function.

## A line that does not resolve is SAID

Three ways for a binding to fail, and all three are **reported** rather than dropped. That is
where this file parts from st0's MIDI join: there a map travels with a module into projects that
draw it differently, so an inapplicable binding is a normal state to skip silently. Here the file
belongs to THIS set and names THIS set's nodes — a line that does not resolve is a typo on its own
project, and saying so is the difference between a dead fader and a fixable one.

A missing WIDGET is the only non-fatal case: without it there is no `min`/`max`, so nothing to
scale — but the target exists, and declaring it broken would be wrong. The binding resolves
without a widget and the caller decides (the desk sends the control's own units).

A control **named and not wired** — what a surface skeleton is made of — is skipped without a word
here: `unmappedControls` reports it once, as a gate over the whole desk.

## The two paths

The crossfader and the six EQ knobs bind to a PARAMETER: the desk plays the compiled document (see
[mix.md](mix.md)), so `deckA:crossfade` and `deckA:eqA` are plugins the engine has loaded, and
moving the control sets the parameter on them. One message per movement, at every pixel. See
[eq.md](eq.md).

The tempo fader binds to a TRACK. The `tempo` module is `offline`: it has no plugin, it is made
true outside the graph — here by the clip stretch Tracktion does live. So the binding gives the
track whose material the module treats, and that clip is what gets warped.

Both are declared. Repoint `deckA.tempo` at `tempoB` in `views/mix.yaml` and deck B stretches
under the left fader — which is exactly the difference between a declared control and a wired one.
The fader always belongs to a deck (its scale comes from the loaded track, a fact about what is
playing rather than about the wiring); what it MOVES comes from the file.

### What decides the path — and why it is not the graph

It is the COMPILED DOCUMENT, never the graph, and the distinction is finer than it looks.

`buildGraphDoc` gives a `pluginId` to EVERY step of a chain: the `chain:module` address the step
*would* have. Including steps the compiler emits no plugin for — it literally does
`if (rawType === OFFLINE_TYPE) continue`. An `offline` module therefore comes out of the graph
wearing `deckA:tempoA`, and the document has nothing of the sort.

Deciding "parameter or track" by looking at whether the step has a `pluginId` therefore files
every tempo fader on the parameter side, and `set-plugin-param` leaves for an address the engine
does not know. No error, no log: the fader moves and nothing happens.

`enginePluginIds(compiled)` collects the identifiers the engine will really have once the document
is sent, and `hasPlugin()` is the question to ask. General rule: the graph describes what is
DRAWN, the document describes what PLAYS — to know what to send the engine, ask the second.
