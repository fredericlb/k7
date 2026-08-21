# Cutting the MATERIAL — `event split` and `selection consolidate`

Two verbs that write new material, where every other `event` verb only rewrites placements.

`trackMix.ts` moves, resizes, splits and joins **placements**: lines in a lane's `events:`. It
never touches a file under `clips/` or `sequences/`, which is what makes those edits one line to
undo and what decides everything they refuse. These two are the other half — they exist precisely
for the cases those refusals name.

| verb | what it writes |
|---|---|
| `event split` | two materials, and a placement pointing at each |
| `selection consolidate` | one material over a range, and one placement of it |

Two verbs, and both write. That is the whole design, and it was not the first one.

## There was a VIRTUAL pair, and it is gone

`event split virtual` cut without writing — two placements of one material, the head stopping at
the cut and the tail opening there — and `event join` put such a pair back. Neither touched a file
under `clips/` or `sequences/`, which made them free and exactly reversible.

They were removed because the freedom was the wrong half of the trade:

- **A split you cannot treat the halves of is not why you split.** The reason to cut an event in
  two is to process, warp or replace one side. Two placements of one material cannot diverge —
  every edit to the material moves both.
- **The join's every refusal was a case consolidate writes.** A different material, a gap, an
  overlap, a neighbour restarting the material: it held out for the one arrangement where nothing
  had to be written, and refused the four where something did. One verb rejoins a range now,
  whatever is in it.

What was lost is real and worth knowing: **there is no free, exactly-reversible cut any more.**
Splitting writes two files, rejoining writes a third, and the material a split cut is left on disk
rather than deleted. On audio each of those is a render, so both verbs need a machine with an
engine on it.

## The one contract

**What you hear must not change.** A physical split's two halves played back to back are the event
that was there; a consolidation played once is the rectangle that was there. Every refusal below
and every detail above exists to keep that true, and `materialCut.test.ts` asks it a dozen ways.

Three consequences that are easy to get wrong:

- **A note straddling the cut is truncated, not dropped.** What was sounding at that moment goes on
  sounding up to it. Dropping it would make the halves play something the whole never did.
- **A split's halves carry their extent.** A head whose last note stops before the cut still ends
  *at* the cut, because the new sequence carries a `to:`. Without it the material would end where
  its notes do and the pair would play shorter than the event did. Safe there, and only there: the
  notes are clipped to the cut, so they can never run past the extent.
- **A consolidation states its window in full** — `from` at the rectangle's start, `to` at its end
  — so the new material says exactly what was selected, and a gap at either end is kept. A
  sequence with no `to` ends where its last note does, which would simply lose the trailing
  silence of a selection.
- **…and that window is never narrower than what it holds.** The rectangle selects by where an
  event STARTS, so a selected event may legitimately play past the right edge. Taking the extent
  from the rectangle alone declared the material over before its own notes: they sat in the file,
  after the end, and nothing played them — measured, in a real project, as two notes at beat 3.01
  under a `to:` of beat 3. `Math.max` with the last note's end is what fixes it. **The window may
  only ever be widened by its contents, never narrowed.**

## Two implementations, because they are two different acts

The KIND of material decides which runs, and they do not live together:

- **Sequences** are text this package already reads and writes, so `materialCut.ts` divides the
  notes and writes the files itself. No engine, no machine, pure and fully tested.
- **Audio** has to be RENDERED. That lives in `@studio/commands`' `materialRender.ts`, beside the
  bounce that already owns "write new material through the engine" — it builds a one-track
  `ProjectDoc` and runs `renderMixdown`, exactly as `clip process` does.

The command handlers (`event.split`, `selection.consolidate`) are the only place the two meet:
they read the clip's `type` off the compiled document and call one or the other. With no engine
binary on the machine, the audio path says so rather than failing further in.

## What is left behind, and why

**The material that was cut is never deleted.** Another placement, on another lane, may still be
playing it — and this verb cannot know what was meant to be kept. A `sequences/` folder gaining a
file is cheap; a project that stops compiling because a file went out from under a placement is
not. The log says which material was left.

New names are uniquified rather than overwritten: `<ref>-1`, `<ref>-2`, … for a sequence, and a
timestamp for audio (the same `fileStamp` a take uses). A split run twice therefore leaves four
sequences rather than silently replacing the first pair — the right default for a verb whose whole
point is that it writes.

## What a rendered definition STATES, and what it deliberately does not

`clips/<ref>.yaml` gets a `source:` and **nothing else**. No `from`, no `to`.

`from`/`to` are a WINDOW into a file, and a render **is** its file: there is no window. Carrying
the numbers over from the thing it was cut out of would frame it with somebody else's, and writing
a `to` equal to its own end would not be a window at all — it would be the file's **duration**,
copied into the song. A copy goes stale: `clip process` repoints `source:` at a processed wav of
another length and nothing notices, so the clip would draw and play to a second the file no longer
has. The length of a file is the file's, and it stays there.

`recordTake` writes `from`/`to` and is not the exception it looks like: a take's window is
**musical** — it was recorded to the click, and its two edges are timecodes. A render's extent is
a fact about audio, in seconds, which is a different kind of thing.

### The length the surfaces need is answered elsewhere

The reason to want a `to` here was real. An absent extent compiles to `length: 0`, which means *to
the end of the source*: the ENGINE fills it in from the file it holds, and the browser cannot — it
may not resolve a path on the engine's machine, let alone read a header. So a 0 reached the
timeline, which fell back to drawing **one bar**, and a three-bar consolidated render was drawn as
one while playing all of it.

That is answered on the side that HAS the audio. The file service measures the source and fills
the length in on its way to the browser — `naturalBeats` in `packages/file-service/src/workspace.ts`,
memoised on each file's size and mtime, from the in-point. The compiled document the engine
receives still says 0, because 0 is what is true there. Nothing is written into the song at all.

## What `selection consolidate` takes, and why it is plural

`<tracks> <from> <to>` — the rectangle, exactly as `events move` takes it, and one lane.
`tracks` is plural although it acts on one, and deliberately: the timeline's
selection can span several, so the refusal has to be sayable *here* rather than in whatever built
the line. A consolidation across two lanes has no obvious answer — one file, or one per lane — so
it is refused rather than guessed.

A repeat inside the range is **unrolled** rather than refused: a loop is N copies of one window
laid end to end, which is exactly what the consolidated material has to contain.
