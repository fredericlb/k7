# Short forms in a .k7x file

A `.k7x` file may write some data in a short form, for the person typing it: a sequence's notes as a
line of mini-notation, a graph's segments as runs. `src/yaml/sugar.ts` expands them into the data
they stand for before anything reads the file — the schema, the compile, the editor's check — so no
reader knows they exist. The format they live in is `packages/k7x/docs/language.md`.

```js
// sequences/riff.k7x
notes("c4 d4 [e4 f4] ~ [c4,e4,g4]@2")
to("3:1")

// graph.k7x
runs([
  ["melody", "lead", "MIX", "OUT"],
  ["pad#midi", "synth-pad", "MIX"],
])
```

## A short form is for writing, the data is what is kept

A write that leaves what a short form expands to unchanged keeps the short form: moving a
sequence's window, bypassing a node. A write that changes it — a note dragged in the roll, a link
added on the graph — writes the full data in its place, `notes([t(0).d(1).k(60), …])` or `modules({…})`.

The alternative, writing the short form back, only works for what the short form can say: notes on
a grid at one velocity, segments that line up into runs. A roll edits notes off the grid and one at
a time, so a rule that kept the short form would have to give up on most edits anyway, and an edit
that half kept it would be worse than either. The rule has one implementation, `applySugared` in
`packages/k7x/src/sugared.ts`, re-exported by `src/yaml/sugar.ts`: it lives in k7x because it is a rule
about documents rather than about any kind of file, and k7x cannot depend on this package. Song's
k7x door applies it to every edit of a file with short forms (`packages/song/docs/k7xFiles.md`).

For the graph the rule is stricter still: once a segment changes, `runs` goes entirely. Left in
place beside a full `modules`, a run would put back a link the edit had just removed.

## The notes, by the beat

One step is one beat, because a sequence's time is in beats (`NoteSchema`'s `t` and `d`) — not one
cycle as in Strudel, which has no meaning on an arrangement's timeline. `seq("…").step(0.5)` sets
another step length and `.v(0.8)` a velocity for every note.

| written | means |
|---|---|
| `c4`, `f#3`, `bb2`, `60` | a note: a name and octave (C4 = 60), or a MIDI key |
| `~` | a rest, the step left empty |
| `[d4 e4]` | the step split equally between its notes |
| `[c4,e4,g4]` | a chord: every layer over the whole step |
| `c4@2` | a step two steps long |
| `c4!3` | the step three times in a row |

That is the subset a sequence needs. Strudel's alternation (`<a b>`), polymeters and randomness
describe patterns that change from one cycle to the next; a pattern lane already plays those, from a
`.strudel` file (`engine/k7-runtime/docs/patternPlugin.md`).

## A short form that does not read

It is reported against its key, `notes` or `runs`, on that key's line in the k7x text, with the step
it could not read — by the editor before a save and by the loader after one (`src/yaml/k7xIssues.ts`).
