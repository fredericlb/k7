# `trackMix.ts` — writing a lane's file

Mixer and placement mutations: rewrite a lane's own file in place so the change round-trips the
same way for every surface that reloads it (TUI watcher, web refetch). A surgical edit, never a
re-serialization.

A lane lives in `nodes/`, because a lane IS a node of a `@studio/…-track` module, and the file
is named after it.

## What a lane's own file carries

`color` and `disabled`, and nothing else (`packages/song/docs/trackModules.md`). Its mute is its
module's bypass, written to `graph.yaml`'s `bypassed:` — one state in one place — and solo is
derived by the surface; `volume` and `pan` belong to the `Mixer` module; `frozen` is a point in
the graph rather than a lane's field.

A track's `volume` is a LINEAR GAIN, not dB: 1.0 is unity, 0.5 is −6 dB. The fader floor is
−60 dB, below which silence is stored, and the ceiling is +6 dB — Tracktion's fader position
saturates at 1.0 there, so a louder value plays at +6 anyway. `dbToGain` clamps in dB rather
than on the converted gain, so the ceiling is the one number the fader also uses.

## How a placement is addressed

By its POSITION IN BEATS, never by the text of its `start` — `"1:1:1"`, `"1:1"` and `"1"` are
one position, and `yaml/trackFile.ts` owns the writes that make that true.

`moveTrackPlacementsInRange` is the bulk form, and it exists for a property a loop of single
moves cannot give. It collects every start BEFORE rewriting a line, then edits by INDEX:
indices are stable under a start rewrite, so the starts collected up front stay true addresses
for the whole pass. Moving one event onto another's start would otherwise shadow that event's
address mid-pass. One file rewrite however many events the range holds, so the whole gesture is
one journal step for the caller.

`movePlacementToTrack` carries a placement WHOLE to another lane's file, and cuts first: a miss
leaves both files untouched. Refusing a move between lanes of different kinds is the caller's
job (the `event.move` command).

`addTrackPlacements` is likewise not a loop over `addTrackPlacement`, and the difference is the
whole reason it exists: the single form reads, transforms and writes per placement, so a paste
of twelve events would be twelve reads and twelve writes of one file — and twelve chances to
fail with half of them landed. The transforms are pure text, so folding them inside one
`editTrackStruct` is both cheaper and atomic. Order is the caller's; they are appended as given,
which is what a paste wants, since `events:` is a list rather than a sorted index and the
compiler reads positions rather than order. It takes a WHOLE placement, not just where it goes —
a paste reproduces the event it copied, window, fades and passes included.

Adding lands on the set the lane is PLAYING: `addPlacement` resolves that per document, so a
lane running an alternative gets it where it can be heard
(`packages/song/docs/alternatives.md`). And it writes a REFERENCE — the clip is not moved,
copied or altered, and nothing stops the same material sitting on two lanes. Removing is the
same asymmetry: deleting the last placement of a clip just leaves it unplaced.

## Absent means default

`setPlacementFieldAt` DELETES on `undefined`, and every field written through it uses that to
say "back to the default". Switching a flag off and on again leaves the file exactly as it was,
rather than accumulating a `disabled: false` on every event anybody ever touched.

Which value is the written one depends on the field's default:

- `disabled` is written when true and deleted when false;
- `warp` is the other way round — warping is what a warped clip does everywhere, so `false` is
  the written value and `true` deletes the field (`PlacementSchema`'s `warp`);
- a fade of zero deletes, so dragging one open and closed again leaves the file as it was.

A fade is a DURATION, which is why it writes `beatsToDuration` and not `beatsToPosition`. The
two spell the same number differently — a one-beat fade written as a position is `1:2:1` rather
than `0:1:0` — and `placementToClip` reads it back with `parseDuration`, so the pair has to
agree or a fade lands a bar out.

## The event's window

`setTrackPlacementWindow` writes the placement's `from`/`to` in SECONDS, which is where an
event's window lives: a clip file describes the bytes, a placement describes the use
(`packages/song/docs/materialCut.md`). It is what the clip panel's two edge handles commit and
what `event window` writes.

Seconds and not a timecode, because that is the axis the gesture happened on — a waveform is a
file, and a hand pointing at it is pointing at a second of it. Both spellings stay legal on the
field (`WindowEdge`), so a window somebody wrote musically by hand is only converted if they
drag it, at a hair of rounding at 0.1 ms, finer than a sample at any rate.

A `from` of 0 and a `to` past the end are DELETED rather than written: absent already means the
material's start and its end, and a file full of edges that restate the file makes "not trimmed"
and "trimmed to exactly the whole thing" read alike. `dur` is what the caller knows the source
to be; 0 means unknown and the `to` is always written. Both edges are written every time — an
edge the drag decided against has to go, or it would keep narrowing what the other one just
opened. Two writes and one file, and `editTrackStruct` skips an unchanged text.

## Resizing

`resizeTrackPlacement` re-times one event so it spans `startBeats..endBeats`, and the edit lands
on the PLACEMENT: its `start` when the left edge moved, its `loop` when the event repeats, and
otherwise its own `from`/`to`. The material's window is read but never written — it is the CAGE,
the most restrictive pair winning, so the event's window is clamped inside it and an edge that
only restates the material's own is cleared rather than copied. The placement then says nothing,
which is what "no further restriction" should look like in a file. See
`packages/song/docs/clipResize.md`.

Windows are read AS AUTHORED: a timecode window is parsed the way the compiler parses it, so a
resize of a file spelled that way lands on the same numbers rather than a beat off. The
EFFECTIVE window — material and event intersected — is what the drag was aimed at, because that
is the extent that was on screen.

Three defaults on the way back out: `loop: 1` is cleared rather than written, a looped event's
`from`/`to` do not move at all, and a `to` landing on the material's own is cleared — except
when the material states none, in which case the event's `to` is the only thing giving the
extent a number and it stays.

## Takes are next door

They were here, and they are `trackTakes.ts` now — the lane-level face of `trackFile`'s three
writers, on the same terms every other mutation here uses: a lane by its id, resolved to
`nodes/<id>.yaml`. What moved them out is that a take stopped being the whole lane: deciding
WHICH clips a pass displaced is arithmetic over the compiled document (`splitUnder`), and that has
nothing to do with rewriting a placement's `start`. See `packages/song/docs/takes.md`.

`pushTrackClipsToTake` still answers false when there was nothing to set aside — recording onto
an empty lane, or beside everything on it, is not recording OVER anything.

Both it and `selectTrackTake` take their picks as START POSITIONS in beats rather than as indices,
which is how every other address in this file is spelled: an index would be an offset into a list
the caller does not hold, and the compiled clip it comes from has a start and no index.

## What is NOT here

Placement arithmetic that does not cut material: move, resize, disable, warp, add, remove. There
is no split and no join in this file. Cutting and merging WRITE material and live in
`materialCut.ts` — a split whose halves you cannot treat apart is not worth cutting, and every
case a join would refuse (a different material, a gap, an overlap, a restart) is a case
`selection consolidate` writes, at the cost of a file.

A lane's ALTERNATIVES are not here either. They belong to the MODULE a lane is, so the verbs are
`node alternative …` in `projectEdit.ts`, and which event list an edit lands in is
`yaml/trackFile.ts`'s `eventsToEdit`.
