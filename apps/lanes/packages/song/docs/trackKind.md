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
loader's filename order). A project that uses neither pins nor prefixes therefore comes
out exactly as it went in — nothing is reshuffled until a name asks for it.

Two names claiming the same slot is not an error: the lower-numbered (then earlier) one
takes it and the other moves DOWN to the next free slot, so a duplicated number costs
one position rather than losing a track. A number past the end lands last, for the same
reason — `"99."` reads as "put this at the bottom," which is what it does.
