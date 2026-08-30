# The desk's effects, beyond the filter

Three things, and **only one is a module**. That is the point of this page: on a mixer, "effect"
covers mechanisms with nothing in common, and putting them all in the graph would produce two
modules that serve no purpose.

| | what it is | where it lives |
|---|---|---|
| **echo** | a delay with feedback | a module, `@st0/audio/time/echo`, bound by `deckA.echo` |
| **echo-out** | cut the channel, let the tail ring | **a gesture**: two desk controls moved together |
| **censor** | the record runs backwards while held | **a gesture**: the platter's `Rate`, like a scratch |

## The echo, and why it sits AFTER the channel fader

```
deckA → tempoA → trimA → eqA → filterA ─┬→ levelA → echoA → fadeA → MIX
                                        └→ cueA → CUE
```

`echoA` sits **after** `levelA`, and that is not tidiness: it is what makes echo-out possible.
Dropping the channel fader then cuts the delay's **input**, not its output — the delay line keeps
emptying and the repeats ring alone. Wired before the fader it would be cut with everything else,
and the best-known effect on a DJ mixer would not exist. Same reasoning as the headphone send,
tapped on `filterA` to stay **before** the fader ([cue.md](cue.md)): in both cases the place in the
chain IS the feature, not a preference.

The module itself is `@studio/dsp`'s `echo()` function, written in a `jsdsp.ts` next to its
`module.yaml` — a module is a FOLDER you copy, so it carries its source.

Three parameters, of which **one** is a gesture: `Mix` is what the desk knob moves; `Time` and
`Feedback` are set once in `nodes/echoA.yaml` and left.

### What it does not do: follow the tempo

`Time` is in **milliseconds**, placed by hand, and the scaffold default is 375 ms — the dotted
eighth at 120 BPM. The desk does know each deck's BPM: it measures it, publishes it, the tempo
fader uses it. What is missing is a **binding** carrying that number to this parameter, not the
information. A stated limit, not an impossibility — and worth stating, because a DJ echo believed
to be locked to the track and is not sounds like a fault in the machine.

### It is OFFERED, never required

`deckA.echo` is not in `REQUIRED_CONTROLS` — same rule as cue and stems ([controls.md](controls.md)).
A set that wires no effect is a complete set, and the gate must not demand a line whose absence is
not a failure.

On the strip the echo knob is therefore **absent** rather than greyed, which is the other half of
the cue-point rule: greyed says "not yet", absent says "this set has none". A greyed knob would send
someone hunting for a module to repair where nothing is broken. It is also why it costs a row of
`stripHeight` **only** when a deck wires one ([deskLayout.md](deskLayout.md)).

## Echo-out: a gesture, not a binding

Holding the button sends the echo full **and** closes the channel fader. Two parameters — and one
desk control drives **at most one**
([viewBindings.md](../../../packages/song/docs/viewBindings.md)).

The way out is not to loosen that rule: it is that echo-out need not be a binding at all. It
**composes two controls the desk already has** — `deckA.echo` and `deckA.level` — exactly as a hand
would with the two on-screen controls. Nothing new reaches the engine: the same two
`set-plugin-param` a finger would have sent.

What that gives free: the gesture is **reversible with no hidden state**. On release the fader
returns to where it WAS — `heldLevel` remembers — and not to its `home`. That matters on a set:
reopening a channel someone had deliberately left low is exactly the kind of favour you do not do
in public.

It is **greyed with no echo wired**, with the reason: with no module to open, holding the button
would only cut the channel, which is not the effect asked for but looks like a fault.

## The censor: the platter, and nothing else

No module, no binding, no parameter. The record **runs backwards** while the button is held, and
plays normally again on release.

That is possible because a deck is a **platter** carrying its own transport
(`engine/moteur/docs/turntable.md`): its `Rate` is a signed number, so −1 already means "backwards
at record speed". The desk even has the path — `sendScratch`, the one a hand on the vinyl uses
([scratch.md](scratch.md)). The censor is therefore **a scratch the desk performs** instead of
following.

Two consequences that fall out on their own and would otherwise be written by hand:

- **pitch follows speed**, because `platterKey` treats a hand on the record as a varispeed. A
  censor that held pitch would not sound like a censor;
- **release hands the record back to what it was doing** — `rate === null` returns the platter to
  the speed the document would have sent, stretched tempo included.

So it has no control in `controls.ts`, consistent with the rest: the scratch has none either. What
lives in `views/mix.yaml` is what **moves a module's parameter**; a gesture on the platter is
performed by the desk itself.

It is greyed on an **empty** deck: a record has to be there for "backwards" to mean anything.

### Both buttons are MOMENTARY

They listen to `pointerdown` / `pointerup`, never `click`. And `pointerleave` as much as
`pointerup`: a press ending **outside** the button must end anyway, otherwise a hand sliding off
leaves the record spinning backwards for good. That is the bug you only find in public.

They are in the **bottom bar**, beside the SYNCs and the headphones, not on the strip: the strip is
the column of settings you SET, the bottom bar the one of things you DO.
