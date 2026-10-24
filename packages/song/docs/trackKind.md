# trackKind.ts — extended notes

A track name carries its own metadata, in up to three dot-separated parts:

```
[position.][prefix.]label      "3.ge.lead" · "ge.lead" · "lead"
```

The two-letter PREFIX says which instrument the track carries, and it drives:

- the ORDER tracks appear in (`trackKindRank`/`sortTracksByKind`) — a song reads
  top-down the way a mix does: voices, drums, basses, guitars, keys, the rest
- the instrument ICON beside the name (the web app maps a kind to a glyph)

A leading NUMBER overrides the ordering for that one track: `"3.ge.lead"` sits third
whatever its family would have said. Both parts are optional and independent.

This lives in the song model rather than the web app: the order is a property of the
project, not of one view of it, and the icons would otherwise need their own copy of
this table — two places to edit, one of them silently drifting. Pure string work, no
fs, so the browser can import it as-is.

## `sortTracksByKind`

Two layers, because they answer different questions:

- a name opening with a number (`"3.ge.lead"`) claims slot 3 outright — the author has
  decided, and no rule should argue
- everything else falls into family order (voices, drums, basses, …) and fills the
  slots the pins left

The family sort is STABLE, so tracks of one family keep the order they came in (the
loader's filename order). A name with no prefix is placed by what it SAYS — `basse`
among the basses, `acoustic_drums_kit` among the drums (`trackCategory`, and its colour
in [trackColor.md](../../song-schema/docs/trackColor.md)); one that says nothing
recognisable sorts after every family, in the order it came.

Two names claiming the same slot is not an error: the lower-numbered (then earlier) one
takes it and the other moves DOWN to the next free slot, so a duplicated number costs
one position rather than losing a track. A number past the end lands last, for the same
reason — `"99."` reads as "put this at the bottom," which is what it does.

## A STATED order, and why it beats the names outright

`orderTracks` is what the compiler calls, and it answers with one of two things:

- `project.k7x`'s **`trackOrder`**, when the project states one — a list of lane ids, top first;
- the names, through `sortTracksByKind` above, when it does not.

It is deliberately not a blend. Two rules that can both apply to one lane is two answers to "which
lane is second", and the one you get depends on which rule the reader remembers. A project states
its order or it does not.

What `trackOrder` does not name follows the lanes it does, in family order. That case is not an
error to refuse: a lane added by hand, or by a tool written before the list existed, is still a
lane, and dropping it would lose a track over a bookkeeping detail.

**The first reorder writes the whole list.** `track order <track> <position|lane>` reads the lanes
as they compile now, moves one, and states all of them — half an order is not an order, and a list
holding only what moved would put everything else at the bottom by the rule above.

The target may be a **lane** rather than a number, and the timeline's drag always sends one. A view
that clusters its rows — a group's members follow its header — cannot count slots the file would
agree with, so it names the lane whose place is being taken and lets the verb do the counting.

A picture lane is a row of the same `trackOrder`, and its row order is its draw order, the top
picture row in front ([packages/song-video/docs/picture.md](../../song-video/docs/picture.md)).
`picture lane order` writes `trackOrder` too, counting the picture lanes as layers, bottom first;
the timeline's drag names a lane and never a number.
