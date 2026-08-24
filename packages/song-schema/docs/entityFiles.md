# Clips, sequences, curves and video tracks

The rationale behind `packages/song-schema/src/yaml/entitySchemas.ts` — the per-entity shapes. Each
is a FLAT file keyed by its own filename (`clips/kick.yaml` has no `id:`, the name is the id), which
also rules out one file declaring several ids.

## `warp.disable`

Switching the map OFF while keeping it: the clip plays at its own rate, and the markers wait. The map
is the expensive half — an import computes it, and a hand-placed one is minutes of work — so "don't
stretch this" cannot be spelled by deleting it. A material declines its own map the way a placement
already declines it (`warp: false` on an event): same meaning, one level up, and the compiler folds
the two into one answer.

## A clip's window, `from`/`to`

They window the SOURCE FILE: the clip plays that slice of it and nothing else, wherever it is placed.
Written EITHER way, and the spelling picks the meaning:

```yaml
from: 0.25      # a bare number is SECONDS into the file — tempo-independent, so the trim never moves
from: "2:1"     # a timecode is MUSICAL, converted at the project tempo, for material played to the click
```

Both, because both are right for different material. A trimmed field recording wants seconds; a take
played to the click wants "drop the first two bars", and every other time field in a track file is a
timecode — so refusing one of them would only be a rule to memorise. A rack slice's window is the
same two words.

Distinct from a placement's `start`, which is musical and says where on the TIMELINE the clip sits.
Trimming the sample is a property of the material; where it lands is a property of the arrangement —
and the extent is derived, so a placement has no length of its own to disagree with. A placement MAY
carry its own `from`/`to`, and then the most restrictive pair wins: an event can narrow this window,
never widen it (`packages/song/docs/clipResize.md`).

A backwards window would compile to a clip that plays nothing, which reads as a broken file rather
than a bad number — so it is refused where the line can be named. Only checked when both edges are
the same kind: comparing a timecode against seconds needs the tempo, which the schema has no business
knowing.

## `onsets` holds the CORRECTIONS, not the onsets

The detected set is derived data: it lives in the file's `.cache` sidecar, it is tuned by one global
`sensitivity`, and it is rebuilt from scratch whenever the audio's fingerprint changes. Writing a
corrected LIST there would be wiped without a word. Writing the corrected list in the clip file
instead would go stale the moment the threshold moved, and the whole point of the threshold is that
it moves.

So what is stored is the DIFFERENCE, and that is what survives a re-detection: the two lists say
"there is also one here" and "there is not one there", and re-detecting at another sensitivity
re-answers everything except those. Moving an onset is a removal plus an addition, which is what
moving it in fact is. Both are SECONDS into the source file, like `from`/`to` in their bare-number
spelling — never a timecode: an onset is a fact about the material, and would slide under it if it
were musical and the tempo were edited.

## Audio or video

Told apart by the source's extension rather than a discriminant field — which is what `#Clip` does,
and what lets a clip file say only `source:`.

## A note, and a pad

`t`/`d`/`k`/`v` are single letters because every note carries all four and a pattern is hundreds of
them on one line. `repeat` and `skip` are spelled out instead, deliberately: they appear on the few
pads that have an effect, so they cost nothing in width, and a letter apiece would be two more things
to learn from a file that does not explain itself (`packages/song/docs/padEffects.md`).

`repeat` retriggers: play the note that many times inside its OWN duration, which on a pad is the
step it was drawn on. Absent means once. `skip` falls silent on every n-th pass of the pattern: 2
plays one pass in two, 4 plays three in four. Absent means every pass. It means nothing on a sequence
that is placed once, which is not an error — a placement gaining a `loop:` later is what makes it
audible.

## A sequence's window

Timecodes only, and positions — `"1:1"` is the sequence's first beat, `"5:1"` its fifth bar. No bare
numbers here, unlike a clip: a clip's number means SECONDS into a file, and the same spelling meaning
beats one folder over is the kind of rule that is only ever learned by getting it wrong.

## The ADSR curve

An envelope in MILLISECONDS, restarted by an event rather than read off song time. The four stages
are all durations — sustain included, which a keyboard's ADSR does not do. A keyboard holds sustain
until note-OFF, and this envelope has no note-off to wait for: it is baked from the note-ONs of
whatever feeds it, so its length has to be knowable in advance. `level` is the one thing that is not
a duration — where decay lands and sustain holds.

Milliseconds and not beats: an envelope is a gesture of the hand, and a 20 ms attack is 20 ms at any
tempo. Every other curve here is written in bars for the opposite reason.
