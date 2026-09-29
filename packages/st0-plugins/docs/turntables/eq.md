# A deck's EQ

Three knobs per deck — low, mid, high — driving an `eq3` module placed on that deck in the graph.
As with everything else on the desk the link is **declared** in `views/mix.yaml` and not wired in
code; see [controls.md](controls.md).

## The module writes no DSP

The engine already hosts Tracktion's 4-band equaliser (`4bandEq`, registered as `Equaliser`), with
its shelves and bells. `@st0/audio/filter/eq3` is a **name and a set of defaults** on top —
exactly what `audio/utility/pitch-shift` is to the Pitch Shifter. Writing an EQ in `jsdsp` would
produce a second, worse implementation to maintain.

What the module brings is the **crossover points**. Tracktion's are a mastering EQ's: 80 Hz, 3 kHz,
17 kHz. A high shelf at 17 kHz touches only air, so a "high" knob sitting on it would do almost
nothing. The module lays down a channel strip's:

| band | filter | corner | what it takes |
|---|---|---|---|
| Low | low shelf | 200 Hz | the kick and the bass |
| Mid | bell | 1 kHz | the voice, the snare |
| High | high shelf | 6 kHz | the cymbals, the attack |

Three bands of the four. The second mid stays flat: a DJ strip has three knobs, and offering a
fourth the desk does not draw would make a control reachable only through the file.

The frequencies have **no** widget. They are what a band IS, so moving them makes a different
module rather than a different setting — and a mixer does not offer that knob.

## ±20 dB, with neutral at the centre

The range is the plugin's, taken as is. Neutral therefore falls exactly at the middle of the
travel, which is what an EQ knob must do: a knob whose 0 dB is not at noon reads wrong at every
glance. A mixer cuts more than it boosts — by use, not because the control forbids it.

In **decibels**, never 0..1. Same rule as a strip's `Volume`: a surface sending 0.5 for "half"
would look like it worked and be six decibels wrong.

## What a knob shows: three things

| drawn | what it says |
|---|---|
| the small tick at the top | where **neutral** is — the reference, always at noon |
| the **needle** | where the knob is *set* |
| the **arc** from noon to the needle | **by how much** it departs, and in which direction |

The needle alone says a position; the arc says a **quantity**. Its length IS the setting, anchored
at neutral, so a boost pushes the arc right and a cut left, and two knobs compare at a glance
without reading a number. That is why it exists: on a short strip (a desk in a pane) the **numeric
values are dropped** for want of height — see [deskLayout.md](deskLayout.md) — and the arc costs
not one pixel of height.

At rest the arc is **empty**, not a stub, and the number shows **only away from rest**. A column of
knobs each carrying a small mark, or six all reading "0.0", is exactly the noise dropping the
numbers was meant to avoid; what a glance is looking for is which band somebody touched.

`arcPath` (`../../src/turntables/views/ChannelStrip.tsx`) draws two paths — the whole travel, pale, then the arc
over it, so the arc reads against what it could have been rather than against nothing. Both run
**outside** the dial face, radius 18 against the circle's 15, so they never fight the needle for
the same pixels; and the caps are `butt`, not `round`, or a small value becomes a two-pixel blob
instead of a small mark.

## After the tempo, before the crossfade

```
deckA → tempoA → eqA → crossfade → OUT
deckB → tempoB → eqB → crossfade#b
```

The order IS the signal path. A deck equalised after the fade would have its bass cut at the same
time as the other's: the EQ is a property of the **strip**, not of the mix. That is the place a
mixer gives it.

One node per deck, never shared — cutting THIS deck's bass is the whole point, and a parameter
belongs to a use and not to a module.

## The "parameter" path, not the warp one

The desk has two paths, and the EQ takes the crossfader's:

|  | EQ, crossfade | tempo |
|---|---|---|
| in the document | a real plugin | **nothing** (`offline`) |
| what is sent | `set-plugin-param` | the whole document |
| rate | every pixel | throttled to 120 ms |

An `offline` module compiles into no plugin, however confidently the graph hands it an address.
`hasPlugin()` is the question to ask, and it is the **compiled document** that answers — never the
graph. A knob whose target is not loaded is **refused** rather than sent into the void: the band
greys out and the tooltip says why.

## The knob is rotary, and dragged vertically

Chasing the pointer along an arc is the obvious reading of a round control, and the wrong one: the
gain jumps when the pointer crosses the centre, and it is unusable on a knob this size. Up is
more, down is less, over a fixed 160 px travel — what every sequencer does.

`setPointerCapture` is what lets the hand leave the knob's 40 px mid-gesture, the arrow keys make
it reachable with no pointer at all, and double-click returns to the knob's **neutral**: the only
position worth a shortcut, and the one a drag never hits exactly. Neutral is a property of the
knob rather than the number zero — flat on an EQ band, the record as it was cut on a stem — so the
control is handed it, and the readout that goes quiet at rest reads it too.

## One truth, two pictures

The desk and the graph draw the same plugins and read a **single** picture of them. Without
`liveParams`, every graph widget would fall back on `n.params`, the number the project file
**declares**: an EQ turned in Mix would stay at 0 dB in the graph, and a knob turned in the graph
would do nothing at all, having no `setPluginParam` to call. The two halves are one wire.

The link therefore lives in `Studio` and not in `MixView`, which Studio unmounts as soon as you
switch to the graph: a `useEngine` inside would leave only one view connected at a time, so no
shareable picture. `Deck.params` is the `PluginParamsStore` both read.

The engine is the only thing that knows what a plugin is set to, and it reports it whichever
surface set it — measured: subscribe (`watch-plugin-params`), another surface sets
`Low-shelf gain: -12`, a `plugin-params-live` frame arrives with `-12`. Studio subscribes to every
plugin the chains compile, and **asks** for their value on subscribing as well: without that, a
plugin that never moves again would be drawn from the file for the rest of the session.

A surface's local state is therefore an **optimistic** layer on top, never a replacement:
`shownValue` takes precedence first, the engine second, and `engineAgrees` drops the optimism as
soon as the engine has caught up. An override that never yields is a control that has stopped
listening — the engine can clamp what it was sent, and the other picture can move the same
parameter.

That is also what makes a −12 dB scoop **still there** on returning from the graph, where a private
copy would redraw the knob flat while the sound said otherwise.

### And the tempo, which has no plugin at all

The crossfade and the EQ are real plugins: the engine holds them, reports them, everything follows.
The tempo is `offline` — the compiler emits **no** plugin — so there is nothing to watch and no
address to watch it at. The parameter store can do nothing for it.

Its value exists all the same: on the surface that REALISES it, the desk. The desk lends it through
`Deck.moduleParams`, and the graph borrows it — `moduleParams` on the chains view, indexed by
MODULE NAME since there is no plugin id. On the `Deck` and not in MixView, because MixView is
unmounted exactly when the graph is on screen, the one moment the graph needs it.

And it is **turnable** from the graph, because the decks' state is not in MixView: `useDeckSet`
lives in Studio and so outlives the tab. It is the same node answering for three things — a round
trip through the graph keeps the songs loaded, leaves the crossfader where it is, and the tempo is
settable from both sides. See [deckSet.md](deckSet.md).

The return path goes through the DECLARED binding, read backwards: the graph knows only a module
and a parameter, and `controlDriving` finds the control driving them. Re-pointing a line of
`views/mix.yaml` therefore moves this knob's effect too.

## What to know

A `params:` changed by hand in `nodes/eqA.yaml` does not move the knob until the project is
reopened: what the knob shows is the **engine**'s state, and the file only reaches the engine at
the next document send.

And `extends: "@engine/equaliser"` resolves against the **machine's plugin scan**
(`<state>/exts.json`, a path no environment variable moves). On a machine that has never scanned,
the reference does not resolve and the module becomes a **stub** — silently for the compiler, which
then emits no plugin. The graph does draw it as a stub. That is what makes an EQ "absent with no
message", and it is why the scaffold test's fixture declares the plugin inline instead of depending
on the scan.
