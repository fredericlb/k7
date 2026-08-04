# A song's variants

A song is a folder with a sidecar. That sidecar may declare **variants** — other versions of
the same piece:

```yaml
# songs/Miles Davis/Kind of Blue/So What/song.yaml
title: So What
artist: Miles Davis
variants:
  instrumental: instrumental.wav     # a file beside the master
  sans-voix: blindtest/vocal-strip   # a chain the médiathèque holds
```

Two kinds, and they are told apart by looking in the folder: a value naming a **file that is
there** is a file variant, anything else names a **chain**.

## Why the check runs one way only

The direction is deliberate. A name that is not a file beside the master reads as a chain — never
as a *missing file*. Backwards, a typo'd chain name would be reported as a file that isn't there,
and send you hunting through the song's folder for something that was never meant to be in it.

## Why the scan does not confirm a chain exists

It cannot, and it must not try. The catalogue invalidates **one family at a time** — that is what
makes a listing cheap, and `catalogue.ts` says so where the revision token is computed. A song
listing that depended on the chains listing would serve a stale answer every time a chain
changed, and the cache would have no way to know.

So the scan settles the half it can see alone, and `SongVariant.kind: "chain"` means *"not a
file beside it, so it names a chain"* — not *"this chain exists"*. Whoever holds both listings
answers that; today that is `SongVariants.tsx`, which fetches the chains family and says
**introuvable** on the row when nothing answers.

## How a chain is named

By path (`blindtest/vocal-strip`) or by bare name (`vocal-strip`). Path is matched first, so a
chain whose name collides with another's tail still resolves to the one asked for, and the short
form stays available for the common case where there is no ambiguity.

## The drawing

A chain variant is **drawn**, through the same `ChainView` the chain editor uses — which is the
same `buildGraph → layout → DomChains` pipeline l8 and m9 run. One figure per chain, not one
merged graph: two variants are two different treatments of the same song, and overlaying them
would suggest a signal path running through both.

The input node is the interesting part. A template on its own says `@in`, because it is generic.
Applied to a song it becomes **concrete**: the source is that song's master, so the drawing
says which file goes through the chain. That is the `io: file` input at this level — a source
whose audio is a file rather than an interface channel. See `@studio/song`'s `docs/fileInput.md`.

## What is not here

Rendering. Nothing produces the variant's audio yet — a chain variant is a declaration of how the
song should be treated and a picture of that treatment, not a bounce. The engine seam for it
is the piece `docs/fileInput.md` describes as still to write.
