# Choosing a track

**You click the centre of the vinyl.** The middle of a record is where its name is written, so
that is where you press to change it. The record itself stays `pointer-events-none`: only the
label takes the click, which leaves the outer groove free for grabbing it to mean scratching.

A box opens, holding the tracks **of the set** — not of the whole media library. It is the
**playlist the surface names** that says what is within reach tonight; searching 279 tracks when
the set holds twelve is searching the wrong list.

That is a parameter of `surfaces/<desk>.k7x` — `playlist: ete-2026`, a name under `_playlists/`
at the repository root — and the playlists themselves are written in k7, under the cog. See
[setList.md](setList.md) for the why, and `@studio/song/docs/playlists.md` for the format.

The desk does not write them: from here you **load** a track, you do not build the setlist. The
two gestures happen at different moments — one at home, one in the booth — and an "add" button
next to a crossfade is a button pressed by mistake.

## The sort: artist, then title

`localeCompare` in French, not code-point order. `Alizée` files between `Alain` and `Daft`, where
a raw comparison puts every accented artist after `Z` — that is to say half of this library.
`numeric` while we are here, so `Track 2` precedes `Track 10`.

The artist is shown **above** the title and smaller: the list is sorted by artist, so that is the
column the eye follows down.

## The search

It filters the **whole list**, never what is on screen. Two things make it usable at a desk:

- **Accents are folded.** `alizee` finds `Alizée`, `rose` finds `Rosé`. Nobody composes an é
  mid-mix, and without this half the library becomes unreachable.
- **Terms count in any ORDER**, across artist and title: `bashung nuit` finds *La nuit je mens*
  without knowing which field carries which word. A plain substring over the two fields joined
  fails on that, and searching field by field fails twice.

`Enter` loads the first **playable** result — not simply the first, so a keystroke aimed at the
row below does not load a track still syncing.

## What is not loadable stays visible

A track the cache does not have yet is shown, greyed, with its download icon and the reason in a
tooltip. The three states are the `SetList`'s (see [setList.md](setList.md)): not in the cache
yet, folder with no audio, no engine. Hiding it would make a set missing three tracks
indistinguishable from a set that never had them.

## One box for both decks

`browsing` holds the deck concerned, or `null`. Two dialogues would be two states able to
contradict each other about which is open. The search is cleared **on the way out** rather than
on the way in: reopening for the other deck must start clean, and a search left behind would hide
the set behind someone's last word.

It is also the desk's only list: the middle belongs to the decks, which want the width
([mix.md](mix.md)).
