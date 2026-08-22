# padEffects.md — a step sequencer pad's two effects

A **pad** is one cell of the step sequencer, and one note in `sequences/<id>.yaml`. Two effects can
be put on it, from the right-click menu:

| effect | file | what it does |
|---|---|---|
| repeat | `repeat: 2` \| `repeat: 4` | retriggers the note that many times **inside its own duration** |
| skip | `skip: 2` \| `skip: 4` | silences it on every **nth pass** of the pattern |

```yaml
notes:
  - { t: 0, d: 0.25, k: 36, repeat: 4 }   # a roll on the downbeat
  - { t: 1, d: 0.25, k: 38, skip: 2 }     # a snare that sits out every other bar
```

`skip: 2` plays one pass in two and `skip: 4` plays three in four — the pad is silent on the nth,
which is the literal reading of "skip it every n". It counts passes of the whole pattern, so it
means nothing on a sequence placed once; a `loop:` appearing on the placement later is what makes
it audible, and that is not an error worth refusing.

The menu offers 2 and 4. The **schema accepts any whole number from 2 up**, so a `skip: 3` can be
typed for a three-against-four feel even though no row offers it.

## Why the words are spelled out

`t`/`d`/`k`/`v` are single letters because every note carries all four and a pattern is hundreds of
them on one line. These two appear only on the few pads that have an effect, so they cost nothing
in width — and a letter apiece would be two more things to learn from a file that no longer
explains itself.

## Off is a DELETION, not a value

There is no `repeat: 1`. A pad that plays once on every pass is a pad with **neither key**, so
turning an effect off removes it, and the schema refuses anything under 2 precisely so that the
"off" state cannot be written down twice. Same rule as the velocity drag going back to full, and as
`alternative:` going back to the first set.

That is why the commands take `off` rather than a number:

```
sequence note repeat <sequence> <note> <start> <2|4|off>
sequence note skip   <sequence> <note> <start> <2|4|off>
```

Both address a note the way every other `sequence note` verb does — by key and by where it starts.

## The ENGINE realises them, and that is the whole design

The compiler carries both **unexpanded**: one note per pad, with `repeat`/`skip` beside it, all the
way onto `ClipDoc.notes` and `WebClip.notes`. `EditBuilder::insertMidiClip` is what expands them.

The temptation is to expand in the compiler, where it would be a dozen lines of TypeScript. It is
wrong for one specific reason: **the sequencer draws the same document the engine plays.**

- `repeat` alone could be expanded either side. A pad with `repeat: 4` would become four notes in
  one cell, `notesByCell` takes the first, and the grid would still light one pad — but the pad
  would have lost the attribute the icon is drawn from, and turning the effect off would mean
  removing four notes instead of clearing one key.
- `skip` cannot be expanded there at all. A pass only exists because the clip carries a loop range
  the engine repeats; there is no pass index at compile time. Unrolling the passes would put four
  bars of notes in a one-bar pattern, and the grid would draw all four.

So the split is: the pattern as **authored** is what travels, and the notes as **played** are built
where they are played. A render and live playback then agree for free, since both build their edit
through the same `EditBuilder`.

### What that costs the engine

`repeat` is local to one note: `addNoteWithRepeat` divides the note's duration into `n` hits. The
note's duration is the pad's own extent — the sequencer writes a step's worth when a pad is
pressed — so "in the available time for the pad" needs no knowledge of the grid's precision, which
the engine does not have.

`skip` unrolls. When any note in the clip asks for it, `insertMidiClip` writes the notes out for
each pass, leaves out the pads that are skipped on that one, and **does not apply the loop range**
— the repetition is now in the sequence, and looping it again would play the whole expansion over.
Note times become `(t − loopStart) + pass × window`, which is what the loop range would have
produced.

Unrolled **only when some pad asks for it**. Without that guard every looping sequence would stop
being a loop and become its own expansion: more notes in the edit, and a diff that has to re-insert
all of them for a change to one pass. A pattern with no `skip` takes exactly the path it always did.

`NoteDoc::operator==` compares both fields, for the reason it compares the others: notes are
applied when the clip is inserted and nowhere else, so a pad that gained a repeat has to re-insert
or the change is silent.

## Verifying it

`engine/moteur/scripts/pad-effects.ts` is the proof, and it is a **render measured**, not a unit
test — whether a ratchet happened is not something TypeScript can see.

```
npx tsx engine/moteur/scripts/pad-effects.ts
```

It renders a one-bar pattern of four pads over four passes and counts hits per pass:

| | total | per pass |
|---|---|---|
| no effect | 16 | 4, 4, 4, 4 |
| `repeat: 4` on the first pad | 28 | 7, 7, 7, 7 |
| `skip: 2` | 14 | 4, 3, 4, 3 |
| `skip: 4` | 15 | 4, 4, 4, 3 |
| both together | 20 | 7, 3, 7, 3 |

It also checks that the ratchet's four hits divide the pad's own beat (0.125 s apart at 120 bpm)
rather than running past it, and the last row is the case a naive expansion gets wrong — a skipped
pass must lose the whole pad, not one hit of its ratchet.

**The synth is given a 30 ms percussive envelope on purpose.** On 4OSC's default patch a note rings
for ~350 ms and its release runs into the next hit; against that tail every onset heuristic tried
either missed hits or counted each one twice. Making each hit an island of energy with real silence
around it turns the measurement into counting islands, which needs no judgement at all. If you
change that envelope, expect to be tuning a detector instead.

## Copying a pad

`repeat`/`skip` travel with a note that is copied and pasted, through `NoteIn` and `appendNotes` —
the same rule an event's own attributes follow (`apps/st0/frontend/docs/clipEditors.md`).
