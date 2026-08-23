# Cutting and merging MATERIAL

`materialCut.ts` writes material, where `trackMix.ts` moves and resizes placements. `event split`
writes two sequences; `selection consolidate` writes one over a range. Sequences only — notes are
text this package reads and writes, while the same verbs on audio need a render and live with the
bounce. The vocabulary and the user-facing rules are `packages/song/docs/materialCut.md`; this
page holds the decisions the code used to carry inline.

## Names climb, and nothing is overwritten

`freeSequenceName` gives `base-1`, `base-2`, … and the number keeps climbing past anything
already there — the same uniquifying every other writer here does (`moduleFork`, the recycle bin,
an import). A split run twice therefore leaves four sequences rather than overwriting the first
pair, which is the right default for a verb whose whole point is that it WRITES material.

The material a split cut is **left on disk**. Another placement, on another lane, may still be
playing it, and this verb cannot know what was meant to be kept: `sequences/` gaining a file is
cheap, a project that stops compiling is not.

A sequence that will not read is no notes at all rather than a throw. The compile reports a
malformed sequence, and this verb must not be the surface that raises it.

## A note straddling the cut is TRUNCATED

The cut is a moment in time, and what was sounding at that moment goes on sounding up to it.
Dropping a straddling note would make the halves play something the whole never did, which is the
one thing a split may not do.

## What a written sequence declares as its extent

`writeSequence` states both edges as POSITIONS, quoted — `3:1` unquoted is sexagesimal in YAML
1.1 — and which edges it states differs by verb.

**A SPLIT** passes only a `to`. Its halves are cut to the cut, so their notes can never run past
it, and a head whose last note stops early still has to end where the knife fell. Each half starts
at its own beat 0, so there is no `from` to say.

**A CONSOLIDATION** states both: `from` at the rectangle's start and `to` at its end, so the
material says exactly what was selected. That is what keeps a gap at either end — a sequence with
no `to` ends where its last note does, and the trailing silence of a selection would simply not be
there.

But the `to` is `Math.max(rectangle, last note end)`, and that maximum is the correction that
matters. The rectangle selects by where an event STARTS, so a selected event may legitimately play
past the right edge — and an extent taken from the rectangle alone then declared the material over
before its own notes. They sat in the file, after the end, and nothing played them: present, and
silent, which is the worst shape a bug takes. **The window may only ever be widened by what it
contains, never narrowed.**

(An earlier version had the opposite failure: it wrote the rectangle's span as a bare extent while
copying the notes whole, with the same silent result.)

## Windows and repeats

`windowOf` gives the window a placement of a ref actually plays, in the material's own beats, and
the most restrictive edge wins — the same rule the compiler applies (`nodeProject.ts`).

A consolidation UNROLLS a repeat rather than refusing it: `loop: N` is N copies of one window laid
end to end, which is exactly what the consolidated material has to contain. A split refuses one
instead, because there is no single window to cut.

## Both writes are ONE rewrite of the lane's file

A split replaces the placement's `ref` and copies a second placement in, in one
`editTrackStruct`: a file caught between the two would be a lane playing the head twice, or
nothing at all. Every window on the placement is cleared while it is there — both halves are whole
materials now, and a `from`/`to` left behind would window the NEW file with the OLD file's
numbers.

A consolidation removes highest index first, so removing one placement does not renumber the next,
and adds the replacement in the same pass.

`selection consolidate` selects by where a placement STARTS, both ends inclusive — the rule
`events move` and `event join` already use, so one rectangle means one set of events whichever
verb reads it. It exists for everything `event join` refuses: join puts a run back together only
when nothing has to be written (one material, no gap, each neighbour continuing the last), and
every other case needs a new file.

A split answers null when no placement starts at `fromBeats` — a stale surface, not a broken file.
