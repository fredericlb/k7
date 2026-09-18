# The headphones — cueing one deck while the other plays

Two buttons in the bottom bar, beside the metronome: **A** and **B**, a headphone icon. Press one
and that deck is in your ears, with nothing changed for the room. It is what makes the desk a
two-deck table: you can line the next record up before you launch it.

## It needs no second transport

Both decks **already play at once** — they are two tracks of one document, and the crossfader
decides what leaves. What was missing was not a transport but a second **output**.

What one transport still forbids: launching a deck on its own, and a cue point that moves only
that deck ([mix.md](mix.md), [cues.md](cues.md)).

## Pre-fade: before the crossfader, after the EQ

The tap is taken on `filter<X>` — **after the EQ and the filter, before the fade**. Both halves
are load-bearing:

- **before the fade** — moving the crossfader away from a deck must not take it out of the
  headphones, or nothing can be prepared;
- **after the EQ** — cutting the bass of the incoming deck has to be audible in the headphones
  *before* it touches the room. That is the commonest transition gesture, and hearing it
  afterwards is no use.

## The button switches nothing

`cue<X>` is a node of the `fade` module, like the two halves of the crossfade. Its `Mix` is how
much of that deck goes to the headphones, and the button is that param moving between 0 and 1 —
the same `set-plugin-param` mechanism as the crossfader, the EQ and the stem cuts. There is
therefore **no** cue switch in the engine and nothing new on the wire. At rest `Mix: 0`: a set
starts with nothing in the ears.

A **button** and not a knob, though what it moves is a gain: cueing is yes or no. Headphone
volume is the interface's own amp knob — hardware that already has one, and one control fewer to
draw.

## Unwired is an ORDINARY state — and there are TWO ways to be it

The button is off and disabled in two cases with different remedies, and it says which:

| what is missing | what the button says |
|---|---|
| the PROJECT wires no tap (`cueWired`) | "migrate the set (`migrateSetCue`), or wire `deckA.cue` in `surfaces/`" |
| the MACHINE has named no pair (`cueLive`) | "name it with `system cue 3+4`, or the cue plays nowhere" |

The second is the one that gets forgotten, and without it the button **would light up and do
nothing** — which [hosting.md](hosting.md) already refuses for "Listen here": a command that
cannot be honoured is worse than an absent one.

The desk knows this without asking for anything new: the compiled document's cue track carries
its `outputChannels`, and `leavesByItsOwnPair` reads them. That function asks about CHANNELS and
never about the mute — a `bus_only:` strip is muted too and perfectly audible through its sends,
so trusting the mute would grey out the EQ knobs. A test pins the distinction.

`deck<X>.cue` is **offered without being required** — it is not in `REQUIRED_CONTROLS`, like the
four stems and for the same kind of reason: a machine with one output pair has nowhere to send a
headphone feed, and a desk that refused to draw itself there would be wrong.

## Not to be confused with "Listen here"

Two neighbouring commands, two different questions, hence two icons:

| | what it is | icon |
|---|---|---|
| **CUE A / B** | one deck to the interface's **second pair** — the DJ's headphones | headphones |
| **Listen here** | the master streamed into **this tab**, for a laptop with no monitoring | a laptop |

The second is [hosting.md](hosting.md)'s, and is absent on a host with no stream player. The
first depends on the machine, not on the host.

## Where it leaves, and what happens when there is nowhere

The pair is a fact about the **machine**, not about the set: `system cue 3+4`, filed in
`<state>/preferences.yaml`. A machine that names none plays the cue bus **nowhere** — never
folded back onto the master, which would put the headphone feed into the room. Three doors close
that case, and they are measured: `packages/song/docs/cue.md`.

## What it does not do

A **headphone level** in the app, and a cue/master blend: the interface's amp has its own knob,
and one deck per button is enough to line a record up. The day a machine without a physical knob
needs it, it is an intermediate `Mix` on the same node — nothing structural.
