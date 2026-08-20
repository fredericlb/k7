# A song's variants

A song is a folder with a sidecar. That sidecar may declare **variants** — other versions of
the same piece:

```yaml
# songs/Miles Davis/Kind of Blue/So What/song.yaml
title: So What
artist: Miles Davis
variants:
  instrumental: instrumental.wav     # a file beside the master
```

A variant is a **file beside the master**, and the folder is what settles it: a value naming a
file that is there is a variant, anything else is reported as `missing`.

> There were TWO kinds. A value that named no file in the folder named a **chain the médiathèque
> held** — `sans-voix: blindtest/vocal-strip` — which was drawn as a graph, auditioned through a
> moteur, and bounced to a file beside the master by a « Process » button. The chains family left
> the catalogue with the modules, so that whole half is gone: a sidecar still written that way
> now reads, correctly, as naming something the folder has not got.

## Adding one: the file goes in, and the sidecar says so

A file variant is **two** things, and only having both makes it a variant: bytes in the song's
folder, and a line in `variants:` pointing at them. Writing the bytes alone declares nothing —
the scan reads a song's versions from the sidecar and from nowhere else — which is why
`SongVariants.tsx`'s renderer can `PUT /file` on its own: the line it needs is already there.

`addSongVariant` (write.ts) does both, and `POST /api/mediatek/variant` is it over HTTP. The
médiathèque calls it from a song's context menu (« Ajouter une variante… ») and from a file
dropped onto that song's row — the same call either way.

Three things it refuses or decides, each for a reason:

- **The target must already be a song.** The caller names the folder here, where `POST /song`
  lets it name nothing at all; that is not a hole in the same rule. The rule is that nobody
  invents a place in `songs/` — the shape is derived from tags — so a folder holding neither a
  master nor a sidecar is refused rather than filled. Dropping on the artist or the album row
  therefore does nothing, and says so.
- **The caller does not choose the file name.** It is the upload's own stem through `segment()`,
  keeping its extension, because `ref` is matched against the folder's file names: a name the
  two could spell differently is a variant that reads as a chain.
- **A `variants:` that is not a mapping is refused, not repaired.** A sidecar can say
  `variants:` followed by a list — the scan ignores it (see `readVariants`) — and inserting a
  `key: value` line under that would make the whole file unparseable, which costs the song its
  title everywhere. Fix it in the editor; this will not guess.

The sidecar is edited as **text**, never round-tripped through the YAML serialiser: it carries
the comments that say how the tree is derived. That is the same split `setSongBpm` makes, and
the new line goes at the **end** of the block, so the order in the file is the order they were
added. A folder that had no sidecar at all gets one — there is nowhere else the variant could be
declared.

Re-sending a file already declared replaces its **bytes** and nothing else: a second line
pointing at the same `ref` would draw the variant twice. A *different* file whose stem collides
with an existing name gets the next free one (`instrumental 2`), because the block is a mapping
and the second key would otherwise replace the first.

## Where they show up

In the médiathèque's tree, as the song's **children** — the one place a song is a folder row
rather than a leaf. Clicking one opens the **song**, not the variant: a variant is a line of
that sidecar, and the editor showing the sidecar is where it can be renamed, re-pointed or
removed. The row is named by the sidecar and not by a file, because half of them are not files.

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
same `buildGraph → layout → DomChains` pipeline st0 and m9 run. One figure per chain, not one
merged graph: two variants are two different treatments of the same song, and overlaying them
would suggest a signal path running through both.

The input node is the interesting part. A template on its own says `@in`, because it is generic.
Applied to a song it becomes **concrete**: the source is that song's master, so the drawing
says which file goes through the chain. That is the `io: file` input at this level — a source
whose audio is a file rather than an interface channel. See `@studio/song`'s `docs/fileInput.md`.

## Analysis, and when it runs

A song's master is analysed **at upload**: pl8 receives the bytes, then asks the chosen
machine to compute the waveform envelope, the transient onsets and the tempo, because pl8 has
no engine and cannot decode audio. The `.cache` sidecar is pushed back beside the audio and the
tempo seeds `song.yaml` — see `packages/file-service/src/routes/mediatek.ts` and
`packages/file-service/docs/waveformCache.md`.

A **file variant** is a file in the folder, so it is analysed the same way and by the same
route: it is a path in the library, and nothing about it is special.

A **chain variant** is analysed when its **treatment finishes**. "Traiter" in `SongVariants.tsx`
bounces each chain variant offline on the chosen machine — `--render`, which opens no audio
device, so it runs while something is playing — and writes the result beside the master as
`<variante>.mp3` (or `.wav`: the extension follows what came back, because a wav filed as
`.mp3` is a file that lies about itself). The analysis runs on that produced file, immediately
after it lands.

The tempo it finds does **not** overwrite the song's. `setSongBpm` refuses an existing key, and
`bpm` in the sidecar describes the morceau — not one treatment of it.

Renders are sequential on purpose: each bounce spawns an engine on that machine, and firing one
per variant would have them fight for the same CPU and the same plugin scan.

> **This page used to say rendering did not exist.** It was written before `SongVariants.tsx`
> grew `process()`, and stayed stale long enough to be believed twice. If you are here because
> something told you a chain variant produces no audio, read that function instead.
