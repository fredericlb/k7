# An event's loop, as the clip panels edit it

`src/eventLoop.ts` holds the two writes behind the clip panels' **loop** switch and the brace it
puts in their ruler: `event loop <track> <at> on|off|toggle` and
`event loop points <track> <at> <from> <to>`.

## The loop points ARE the window

A placement has no loop range of its own. It states a window (`from`/`to`) and how many times it
plays it back to back (`loop: N`), and its length on the lane is the product
(`packages/song-schema/docs/moduleFile.md`). So the loop's two points are the window's two edges,
and moving them is a window edit. A second pair of fields — a region played once, then a loop
inside it — would mean a new shape in the song format, in the compiler and in the engine's clip
playback, for a distinction nothing here plays yet.

## On is two passes, off is one

**On writes `loop: 2`**: the least that is a loop at all. The timeline's resize is what sets any
other count, keeping the window and recomputing the passes (`packages/song/docs/clipResize.md`).
**Off deletes the key**, since one pass is the default and a default is written by not writing it.
A switch already in the state asked for writes nothing, so `loop: 6` survives an `on`.

**An audio event with no end gets one.** A repeat needs to know where the window stops, and an
audio clip's file states none until someone writes it (`packages/song/docs/graphModel.md`). The
switch writes the file's length as the event's `to`, rounded down so it never overshoots the file.
With no length to read, it refuses rather than loop something it cannot bound.

## Moving the points keeps the length on the lane

A looped event's passes are recomputed so its extent stays where it was: halve the window of two
passes and it plays four. That is how a loop brace behaves anywhere — the arrangement does not
move under a loop being tightened — and it is the same rule the timeline's resize uses from the
other side. It never drops below two passes: the switch says the event loops, and a drag that made
it stop looping would contradict the switch the person can see.

A single pass keeps its single pass; its points are then simply its window.

**The unit is the material's**: beats into a sequence, written back as positions; seconds into an
audio file, written as numbers. That is the unit each kind's window is written in, and the axis
each panel draws: the roll's ruler counts the notes' beats, the waveform's runs over the file.

**The event can only narrow its material.** A point dragged past the material's own `from`/`to`
stops on it, and an edge landing exactly on the material's is deleted rather than written — the
rule every window writer here keeps. A sequence that states no `to` ends where the compiler says,
its last note rounded up to a bar, and `sequenceExtent` computes that the same way.
