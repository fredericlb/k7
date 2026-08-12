# Racks, and the pads their node draws

A **rack** is a module that is a note→audio sampler rather than a plugin: `type: rack`, plus a
`rack:` block mapping short symbols to MIDI notes and material.

```yaml
# modules/instruments/kit/module.yaml
extends: instruments/drumrack     # a base may ship sounds; this adds and overrides per symbol
type: rack
rack:
  rack_type: samples              # each symbol names its OWN clip…
  symbols:
    SN: { note: 38, clip: snare }
    HH: { note: 42, clip: hat }
```

Two flavours. **`samples`** gives each symbol its own `clip`; **`slice`** cuts every symbol out of
one shared `source`, as a `[from, to)` window in seconds. The compiler flattens both into the same
`RackSoundDoc { symbol, note, clip, start, length }` — the engine is handed one `sampler` plugin
carrying that list, whichever way it was written.

`extends` merges **per symbol**: a kit extending a drumrack sounds its base's kick and its own
snare. That merged rack is the EFFECTIVE one, and it is what everything below means by "the
rack" — `resolvedRack` is the one function that answers it, asked by the compiler and by the
graph alike.

## The node draws a pad per sound

A rack node carries its sounds (`WebChainStep.rack`) and turns them into a widget grid: one
`button` per symbol, labelled with it, four to a row. Synthesised rather than authored, exactly as
a track node's mixer strip is, and for the same reason — the pads are not the module's opinion
about its panel, they are what it IS. Asking someone to also write a `ui.yaml` listing the sounds
would be asking them to keep two lists in step.

An **authored `ui.yaml` wins**: a rack with a hand-made panel has said what its node should show,
and a grid of pads bolted underneath would be the app overruling the file.

### `@rack:<symbol>` is an intrinsic that FIRES

The binds are `@rack:BD`, in the same family as a track's `@mute` — a node intrinsic the renderer
routes itself rather than a plugin param. But it is the one intrinsic that **sets nothing**: it
fires a sound and returns. That is why it has a `WidgetTarget` kind of its own instead of being a
module field that happens to be momentary — it has no value to read back, no address to write to,
and no optimistic override to place.

## Clicking one AUDITIONS the sample

The host decides how a pad is made audible (`onTriggerRack`), and l8 sends it through `preview` —
the same route the editor's gutter ▶ uses: the file service resolves the clip or the slice window
and the engine auditions it through a hidden one-shot sampler.

**So what you hear is the sample, dry.** Not the reverb, the EQ or the mixer that follow the rack
in its chain. That is a real limit and it is deliberate: the engine has no verb for sounding one
note of a *loaded* plugin — its whole client vocabulary is transport, params, preview and
plugin listing — so playing it in place would mean a new protocol message and its C++ side. The
audition route exists, end to end, and answers "which sound is this?", which is what a pad is for.

A host that offers no `onTriggerRack` draws the pads and leaves them inert (`rackTriggerable` in
`Channels`), the same honesty the three writability flags beside it already carry: drawn and
read-only, never clickable-and-silent.

## A pad LIGHTS when the sequence reaches its note

And it is **derived, not observed**. The engine reports no notes: its live frame is
`{ playing, playhead, levels, inputLevels, armed, recordEnabled, waveform }` and nothing about a
sampler's voices. But the browser holds the arrangement and the playhead at the same time, so it
can answer the question itself — `apps/l8/frontend/src/rackLit.ts` turns the lane feeding a rack's
chain into a list of `{ from, to, key }` in arrangement beats, and each frame asks which of them
contain the playhead.

**What that costs, and it is worth knowing before trusting a dark pad:**

| | lights? | why |
|---|---|---|
| a sequence in the project | yes | its notes are in the compiled doc |
| a live MIDI input | **no** | those notes were never written down |
| a strudel lane | **no** | `PatternClock` streams them; the browser never sees them |
| accuracy | ~50 ms | the state frame's own rate |

A very short note is floored to `MIN_FLASH_BEATS` **on the display only**: a thirty-second drum hit
is a handful of milliseconds, and a pad lit for less than a frame flashes on some passes and not
others. What is played is untouched.

Observing it properly means the engine broadcasting its sounding notes — a change to the state
frame and its C++ side, on the hottest path there is. That is the trade this took; the derivation
costs nothing at the engine and is exact for the case a rack is normally used in.

### It reaches the pad through a store, not a prop

`RackLitStore` is subscribed **per pad**, exactly as `PluginParamsStore` is per param and for the
same measured reason: a prop carrying this would re-render every node in the graph on every frame.
The hook returns a boolean, so `Object.is` ends the render at the one pad whose note changed — and
`LiveRackLit.set` wakes only the modules whose sounding set actually moved, so a playhead crossing
silence notifies nobody.
