# The four stems, and what a set calls them

The rationale behind `packages/song-schema/src/stems.ts`. How a separation is RUN is
`packages/stem-separation/docs/stemSplit.md`; how a stem is cut out of a record is
`packages/dsp/docs/stemcut.md`.

## The order is the knowledge

`STEMS` lists the four sources IN THE ORDER the model returns them. That list is knowledge, not a
preference: the output tensor is `[1, 4, 2, N]` and nothing in it says which index is the bass, so
getting it wrong silently swaps two stems — a fader labelled `bass` that removes the drums, which
reads as a broken separator rather than a wrong list.

It lives in this package, which everything else depends on, because it is needed in three places
that cannot import each other: the inference writes the files (`@studio/file-service`), a set's graph
declares a lane per stem (`scaffoldSet`), and the desk loads one clip per lane
(`@studio/ui-turntables`). It was the file service's alone while it was the only reader.

## Where the files go

`stems/` beside the file they came from, never next to it: the médiathèque's scan takes the FIRST
audio file in a song's folder as the master and does not descend, so a stem left alongside could be
played in place of the mixdown. Each is a float WAV — a stem is not a deliverable, it goes back
through a graph.

## The three names a SET uses

A deck that can fade one instrument out is five lanes, not one: there is no fan-out in the document
and no plugin with four inputs (`packages/song/docs/ports.md`), so a stem you can move on its own has
to be a track of its own. `stemLane`, `stemCut` and `stemControl` are the whole vocabulary, and they
are here rather than in `scaffoldSet` because the desk has to recognise the lanes the scaffold wrote
— and a browser package cannot import a scaffold that writes files.

`stemLaneOf` is the reverse of `stemLane`, and the desk's way in: it is handed a compiled document
and has to tell a stem lane from the record's without knowing how the graph was written.
