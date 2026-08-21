# The header meter, and the Fix button beside it

The header carries the mix as it leaves for the interface: a bar, a clip light, and — only after a
pass that clipped — a **fix** button that takes the whole mix down until that pass would have
peaked at **-6 dB**.

`MasterMeter.tsx` is the component. It is a **leaf that subscribes to the engine store itself**,
which is what the store is for: the frame arrives at 20 Hz, and reading the level in `App` would
re-render the whole tree twenty times a second to move a bar eight pixels.

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

One number off **every** strip. That is the whole promise: a single trim applied to all of them
moves the sum by exactly that number and leaves every balance in the song where the person put it.
Anything cleverer — lowering the loudest lane, riding what peaked — would be mixing on their
behalf, and this button is not qualified to do that.

It writes `node param "<strip>" Volume <dB>`, the same line a fader drag commits
(`useTrackControls`), so the trim goes through the undo journal like any other edit. Serially,
because each is a read-modify-write of one file through a single-threaded service, and with **one**
reload at the end — thirty lanes is thirty writes, and bumping the doc on each would refetch the
project thirty times to show a change that is not finished yet.

`gainTrim.ts` is the arithmetic, pure and tested. Four decisions live in it:

- **The trim is never positive.** `masterClipped` is the engine's latched "one sample went over
  full scale"; `master` is a level read at 20 Hz. They can disagree — a single sample over the line
  inside a window whose reported level is well under it — so a naive `TARGET - peak` could come
  back positive and the button would make a mix that clipped **louder**.
- **The peak is floored at 0 dB first**, for the other half of that same disagreement. The pass
  clipped, so it reached full scale whatever the meter averaged out to, and 0 dB is the least it
  can honestly be called. That makes the trim at least -6 dB rather than a button that does nothing.
- **Strips are deduplicated by node.** Two lanes may end on one shared bus strip. Writing it twice
  is a wasted round trip at best and, if the two disagreed about its current level, a race between
  two absolute writes.
- **Values are clamped to the fader's range**, and this is the one place the promise bends: a strip
  already near the floor cannot come down the full trim, so its balance against the others shifts.
  Accepted rather than worked around, because -60 dB is silence — a lane that quiet contributes
  nothing to the peak being fixed, so what shifts is inaudible.

A lane with **no strip** contributes nothing. It is not "at unity" — it has nowhere to put a level,
so there is nothing to lower and inventing a node for it would be a lie.

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

The button goes on the **click**, not when the writes land. The click is the decision, and a
button that lingers through a round trip of thirty writes is precisely the one that gets pressed
twice — taking another 6 dB off a mix already brought down.

It is a callback (`onFix`), not an act the meter performs. Which faders exist and how a level is
written is the host's business; the meter's contribution is the one thing only it saw — the peak.
A host that passes no `onFix` draws no button.

## The fader under it

The bar says how loud the mix IS; the fader under it says how loud it should be — the song's own
output level (`@studio/song`'s [`docs/masterVolume.md`](../../../../packages/song/docs/masterVolume.md)).
Two rows, one column, because they are the same subject read in two directions.

A **native range input**, and that is a choice worth stating in a codebase that draws its knobs on
canvas: those exist because a knob had to show something a range cannot — a bind, an automation
lane, a value arriving from the engine. This is one linear number, and the platform already tells
its keyboard story better than a canvas would (arrows, Home/End, a focus ring, a screen reader).

**`onChange` paints, the release commits.** The rule the mixer's knobs follow: a drag is dozens of
values and each write recompiles the project. Between the two, a local `dragged` value is what the
fader shows — cleared when a fresh document arrives, so an edit made anywhere else wins rather than
being ignored by a fader holding its own opinion.

**Its thumb is half the platform's** (~8px). A default thumb is drawn for a control that owns a
row; this one shares a 24-pixel-wide lane with a meter bar, where at full size it read as a blob on
a hairline rather than as a fader. That needs per-browser pseudo-element rules — `appearance-none`
takes the platform thumb away and each engine's own selector puts ours back — and **both** must be
written or Firefox draws no thumb at all.

**It runs to -60, where the field runs to -100.** Below -60 the curve is silence, and spending two
thirds of a 96-pixel fader on the difference between inaudible and more inaudible would squeeze the
useful range into the top third. `project master -80` still reaches it by name — a fader is for
reaching, not for completeness.

It is drawn only when the host passes both `master` and `onMaster`, so a share — no project to
write to — gets the meter and no fader.

## What the meter does NOT include

The **output trim is downstream of it** (`@studio/song`'s
[`docs/masterVolume.md`](../../../../packages/song/docs/masterVolume.md)). The bar, the clip light
and the peak the Fix button spends all read the mix *before* the fader under them.

That is what keeps the two halves of this component honest. Metered post-trim, raising the fader
would report itself back as if the mix had got louder — and the Fix button, which lowers the
**strips**, would rewrite every lane in the song to compensate for one number you had just set on
the fader an inch below it.

The cost is real and worth knowing: **clipping caused by the trim itself will not light the clip
light.** The meter answers "is my mix too hot"; whether the output overruns what the interface can
take is a different question, and nothing asks it yet.
