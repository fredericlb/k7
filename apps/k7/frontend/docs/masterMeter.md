# The header meter, and the Fix button beside it

The header carries the mix as it leaves for the interface, at the right end of the bar: one lane
holding the meter, the output fader's handle and the mark at unity, then a clip light, and — only
after a pass that clipped — a **fix** button that takes the whole mix down until that pass would
have peaked at **-6 dB**.

`MasterMeter.tsx` is the component. It is a **leaf that subscribes to the engine store itself**,
which is what the store is for: the frame arrives at 20 Hz, and reading the level in `App` would
re-render the whole tree twenty times a second to move a bar eight pixels.

The bar is **scaled, not resized**: a full-width fill with `transform: scaleX(level)` from its left
edge, the way each lane's meter is drawn. A `width` at 20 Hz is a layout per frame, and its
transition a layout per animation frame; a transform is neither. The fill carries no rounding of
its own — the track's `overflow-hidden` rounds both ends, where a scaled radius would squash.

**It is read like a meter**, which a linear bar from −60 dB was not: the scale (`meterFill`, shared
with the desk) gives the top 20 dB — where a mix is judged — 60 % of the length, the fill wears one
of three zones (ok, hot from −6 dB, clip from full scale) in k7's meter tokens, and a **peak mark**
holds where the loudest moment put it for 1.5 s, then falls at 20 dB/s. The mark is a NUMBER computed
with the frame (`nextPeakMark`, `peakMarkLevel`), never a CSS ease, for the reason
`packages/engine-browser/docs/meters.md` gives; it is drawn only while the transport rolls, since no
frame moves it once stopped and a mark frozen mid-fall would read as a level. Its value joins the
reading in the fader's tooltip, the one that shows: the mark sits under the fader like the bar.

## Three things are held across a pass, not a frame

The engine reports per frame; a person reads afterwards. So the meter latches:

| held | rule | cleared |
|---|---|---|
| the clip light | `clipLatch` — an overload wins outright | a new pass |
| the pass's peak | `peakHold` — the running max of `master` | a new pass |
| the offer, once taken | set on the click | a new pass |
| the bar | nothing: it *is* the frame | — |

All three clear on the **same** event, and `newPass` is that event written once so the three read
one expression rather than three copies of it. They answer one question — what did the last pass
do — and a peak that outlived the light would offer a trim computed from a pass nobody is looking
at any more.

The peak lives in a **ref written during render**, not in state. The component re-renders every
frame anyway (the bar moves), so folding a maximum in there is free, where a `useState` would
schedule a second render per frame to store a number nobody reads until the transport has stopped.
And it cannot simply be asked for at click time: by then playback has ended and `master` reads
silence. The pass's peak only exists where somebody kept it.

## What the button does

**It lowers the OUT node's `Volume`** — the song's output level, and the very number the handle on
the bar beside it shows. One write, on the node the whole mix ends at, which is the one edit that
cannot change a balance anywhere in the song.

It writes `node param "OUT" Volume <dB>`, the same line the fader's own release commits, so the
button and the fader are two views of one param rather than two controls with a coincidence between
them. Then one reload, so the fader catches up with the number just written under it.

> **Not every mixer STRIP**, one shared trim across all of them. The strips are where a mix's
> headroom actually lives, which is true and still not something a button is qualified to do on
> your behalf: thirty lanes is thirty read-modify-writes and thirty undo entries, a shared bus
> strip needs deduplicating to avoid a race between two absolute writes, and a strip already near
> the floor cannot take the full trim — so the balance the trim promised to preserve shifts anyway.
> The output has none of those shapes. See
> `@studio/song`'s [`docs/masterVolume.md`](../../../../packages/song/docs/masterVolume.md)
> for why the level sits on the node.

`gainTrim.ts` is the arithmetic, pure and tested. Three decisions live in it:

- **The trim is never positive.** `masterClipped` is the engine's latched "one sample went over
  full scale"; `master` is a level read at 20 Hz. They can disagree — a single sample over the line
  inside a window whose reported level is well under it — so a naive `TARGET - peak` could come
  back positive and the button would make a mix that clipped **louder**.
- **The peak is floored at 0 dB first**, for the other half of that same disagreement. The pass
  clipped, so it reached full scale whatever the meter averaged out to, and 0 dB is the least it
  can honestly be called. That makes the trim at least -6 dB rather than a button that does nothing.
- **The new level is RELATIVE to the current one**, and that is the one that would be wrong
  silently. The meter reads the bus *downstream* of this gain, so a pass played at +3 peaked where
  it did partly because of the +3 — `trimFor(peak)` is how much further down to go, not where to
  land. Writing it absolutely would throw the setting away and undo it in the same click.

Clamped to the field, which is where the button bends: an output already near the floor cannot come
down the full trim. -100 dB is silence, so a mix that quiet has nothing left to clip and the
shortfall is inaudible.

## Why -6, and why the button comes and goes

**-6 dB** is not "just under the ceiling". The point is to give the mix back the headroom it was
mixed without, and it is also where the bar already turns amber (`HOT_DB`) — so the button lands
the level exactly on the mark a person reads as *loud but fine*.

The clip light is **always drawn**, dark when nothing clipped: a light that is only there when it
is on cannot be looked at to check, and checking is what it is for. The button is the opposite and
**appears only when there is something to fix** — it is not a reading to be checked but an offer to
act, and an offer permanently on screen greyed out is a button you learn to stop seeing.

So it leaves both ways it can stop being worth offering: **taken**, and **made stale by a new
pass**. The light stays through the first of those, and that asymmetry is the point — the light
says what HAPPENED, and fixing the mix does not change what the last pass did. Only playing again
can answer that, which is exactly what clears both.

The button goes on the **click**, not when the write lands. The click is the decision, and a button
that lingers through a round trip is precisely the one that gets pressed twice — taking another
6 dB off a mix already brought down.

It is a callback (`onFix`), not an act the meter performs. Where a level is written is the host's
business; the meter's contribution is the one thing only it saw — the peak. A host that passes no
`onFix` draws no button.

## …and the button runs a COMMAND, like every other button here

`project master fix` is the verb (`docs/shell.md`, *every action on screen is a command*), so the
mix can be brought down from the bar, from a key, from the right-click menu — and the transcript
says a trim happened rather than showing a bare `node param` line with nothing above it.

It is **web-local** (`palette.ts`'s `LOCAL_COMMANDS`) although every write it makes is a backend
verb, and the reason is the measurement rather than the act: the pass's peak exists nowhere but in
the browser that watched it go by. The engine reports a level per frame and keeps no maximum, and
by the time anything is clicked the transport has stopped and the bar reads silence. A backend
`project master fix` would have nothing to compute a trim from.

Which leaves one thing to say between the two, and `MasterMeterHandle` is it:

| the handle | why it exists |
|---|---|
| `pass()` | the peak, and whether there is anything to offer about it — a command can be run at any moment, including one where nothing has clipped |
| `take()` | mark the offer spent, which is what the click already did to itself — otherwise a line run from the BAR would leave the button up, and the next click would take another 6 dB off a mix already brought down |

A handle and not a prop threaded back up, for the reason the whole component is a leaf: the peak is
folded during render at 20 Hz, and a callback reporting it would re-render `App` on every frame to
carry a number nobody reads until the transport has stopped.

**A dB may be given** — `project master fix -2.4` — and then the meter is not consulted at all.
That is the line for a pass this browser did not see. Without one, a pass that did **not** clip is
refused rather than trimmed: `trimFor` floors the peak at full scale, so this verb has no no-op to
fall back on and "nothing to fix" has to be said out loud.

## The fader ON it

The bar says how loud the mix IS; the handle riding on it says how loud it should be — the song's own
output level (`@studio/song`'s [`docs/masterVolume.md`](../../../../packages/song/docs/masterVolume.md)).
**One lane, not two controls**: they are the same subject read in two directions, and the level the
handle sets is half the reason the bar reads where it does. The meter IS the fader's track.

A **native range input**, and that is a choice worth stating in a codebase that draws its knobs on
canvas: those exist because a knob had to show something a range cannot — a bind, an automation
lane, a value arriving from the engine. This is one linear number, and the platform already tells
its keyboard story better than a canvas would (arrows, Home/End, a focus ring, a screen reader).

It is laid over the bar with `absolute inset-0` and a **transparent track**: `appearance-none` takes
the platform's track and thumb away, and only the thumb is put back — 4×10 px, in `foreground`, with
a one-pixel ring in the background colour so it stays legible over each of the meter's three
fills. That needs per-browser pseudo-element rules, and **both** must be written or Firefox draws no
thumb at all. Nothing else may sit on top of it: an overlay would eat the drag.

**`onChange` paints, the release commits.** The rule the mixer's knobs follow: a drag is dozens of
values and each write recompiles the project. Between the two, a local `dragged` value is what the
fader shows — cleared when a fresh document arrives, so an edit made anywhere else wins rather than
being ignored by a fader holding its own opinion.

**It runs to -60, where the field runs to -100.** Below -60 the curve is silence, and spending two
thirds of a 96-pixel fader on the difference between inaudible and more inaudible would squeeze the
useful range into the top third. `project master -80` still reaches it by name — a fader is for
reaching, not for completeness.

### The unity mark

A hairline at **0 dB**, drawn under the handle. Unity is the one point of the travel worth finding
without reading the number — the level at which the song leaves as it was mixed — and on a
96-pixel lane running -60…+12 it sits five sixths of the way along, nowhere a hand finds by feel.

It is positioned as **the centre of a thumb at that value**, not as a fraction of the track:
a range insets its thumb by half its width at each end, so a plain `left: 83.3%` would sit a couple
of pixels to the right of where the handle actually stops — enough, on a hairline, to read as the
fader being off unity when it is on it. `UNITY_LEFT` is that arithmetic, and `THUMB_PX` is why the
handle's width is a constant in the module as well as a Tailwind class: **change one and change the
other**, or the mark drifts.

The handle and the mark are drawn only when the host passes both `master` and `onMaster`, so a
share — no project to write to — gets the bar alone, which is why neither is part of the meter's own
markup.

**It is not the only fader on this number.** The chains graph draws an `OUT` card with the same
param on it (`@studio/ui-chains`'s `MAIN_OUT_UI`), because the output is a node like any other and
that is where a node's controls belong. This one is in the header for the reason the meter is: it
answers a question you ask while the transport is running, and the graph may not be the pane you
are looking at.

## What the meter DOES include

The **output level is upstream of it** (`@studio/song`'s
[`docs/masterVolume.md`](../../../../packages/song/docs/masterVolume.md)). The bar, the clip light
and the peak the Fix button spends all read the mix *with* the handle's own level applied.

That is what makes the two halves of this component one control. The button writes the fader's own
param, so if the meter could not see it, a Fix would leave the clip light lit, offer itself again
on the next pass, and take another 6 dB every time — a button that appears to do nothing while
quietly walking the mix to silence.

It reads the other way round too, and is worth knowing: **raising the fader raises the bar.** The
meter answers "how loud is what leaves", not "how loud is my mix". Push the output and the light
will tell you when it stops fitting — at the price that the bar cannot separate the two, and will
not tell you how loud the mix was before the fader.

The master **chain** is upstream of all of it (`@studio/song`'s
[`docs/masterChain.md`](../../../../packages/song/docs/masterChain.md)), so a limiter there is
something the clip light cannot see past.

## The engine's memory, beside its name

`EngineLoad.tsx` shows the engine PROCESS's memory, and its tooltip adds the plugins' summed share
of each audio block. It sits in the header's engine health, with the connection light and the
latency (`EngineLink.tsx`), and not beside this meter: the figure is the engine's, not this
project's — every session on that engine counts in it. Why memory is the process's and not a node's is
`engine/k7-runtime/docs/load.md`; the node's own CPU is on its card. Rounded to whole megabytes
and percents in the selectors, so a report that moves neither re-renders nothing.
