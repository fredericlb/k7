# Correcting the grid

A track's grid is **inferred**: the engine measures a tempo, and [beats.ts](../../src/turntables/beats.ts)
places the first beat on the circular mean of the transients, with a Rayleigh test saying whether
that phase is a measurement or a shrug. It often works. When it does not —
[bpm.md](bpm.md) shows a track (the Bashung) whose detected tempo is plain wrong — there has to be
a way to say so, and to say it in the right place.

## The correction belongs to the RECORD, not to the set

It lives in the track's `song.yaml`, in the media library:

```yaml
title: "Osez Joséphine"
artist: "Alain Bashung"
bpm: 87            # the analysis said 174
key: "C# minor"    # entered, never detected
```

**The test is simple: does it change from one mix to the next?** A tempo, no — 87 BPM are 87 BPM
in every project that plays this record. A key, no either. MARKERS, yes: two bands covering the
same track drop the needle in different places, which is why those live in `mix.yaml`
([mixFile.md](../../../song/docs/mixFile.md)).

And the médiathèque already holds the ground: `bpm:` there is **detected once then edited**, with a rule
saying a present value beats a fresh detection — written precisely because "the engine's estimate
drops an octave on fast material" ([songs.md](../../../mediatek/docs/songs.md)). Which is exactly the
error `÷2` corrects.

## `bpm` replaces what the record IS

Not the label: `Rate = target / natural`. Correcting only the displayed number would leave the
platter spinning at the wrong speed while showing the right value — the kind of fault nobody
finds.

## What an already-moved fader keeps

Correcting the tempo **does not move a fader someone has set**. A fader pulled to 176 to run
against the other deck is a decision; the analysis correcting itself is no reason to throw it
away. So:

- fader at rest (`target === natural`): it **follows** the correction;
- fader already moved: `natural` changes, `target` stays.

A test freezes it, because that is the line whose opposite would be heard mid-set.

## The octave, which is the error a detector actually makes

Under the fader, `÷2` and `×2`. Not shortcuts among others: a detected tempo is right **or wrong
by a factor of two**, almost never wrong by 3 %. A track at 87 read as 174 is the ordinary case,
and two buttons settle it without typing.

Greyed out while no tempo is measured and while there is no media library to write to: there is
nothing to correct then, and a button answering on `0` would write `bpm: 0`.

The write goes to the media library **first**, and the local value follows only once accepted — a failed write
therefore leaves the fader telling the truth rather than a number nobody holds.

When the media library carries a corrected tempo, a `BPM ✎` appears under the two buttons. Only
then: a badge that is always there says nothing.

## The key, and the wheel

`key: "C# minor"` in the same file, **entered and never detected**: the detector was written and
measured against seventeen labelled tracks, and comes in at 53 % — enough to lie, not enough to
serve ([key-detection-plan.md](../../../../docs/key-detection-plan.md)). An entered key is right 100 %
of the time, and a playlist is twelve to thirty tracks.

The desk shows its **Camelot** code under the fader — `12A` for C sharp minor. Storage keeps the
key and not the code: the wheel is a RENDERING, and keeping the rendering would lose the mode's
name. The conversion is in `BpmFader`, and a string it cannot read comes back out as it went in
rather than disappearing.

## What this does not do, and must be said

- **The downbeat cannot be corrected.** It remains the circular mean of the transients.
  It belongs to the record too and could join `song.yaml` the day someone needs it; a field
  nothing reads is a field filled in for nothing.
- **4/4 stays assumed.** `BEATS_PER_BAR` is a constant, and a time signature is not corrected here
  — same reason: nobody reads it.
- **Nothing more is detected.** Correcting is not measuring. Better tempo detection is engine
  work, in the pass that writes the sidecar.
- **Nothing DETECTS the key.** It is entered in the media library; the desk displays it and
  guesses none.
