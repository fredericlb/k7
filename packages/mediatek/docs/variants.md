# A song's variants

A song is a folder with a sidecar. That sidecar may declare **variants** — other versions of
the same piece:

```yaml
# songs/Miles Davis/Kind of Blue/So What/song.yaml
source: upload
variants:
  instrumental: instrumental.wav     # a file beside the master
```

A variant is a **file beside the master**, and the folder is what settles it: a value naming a
file that is there is a variant, anything else is reported as `missing`. That is the whole of
`SongVariant.kind`, and the scan answers it without leaving the song's own folder.

## Adding one: the file goes in, and the sidecar says so

A file variant is **two** things, and only having both makes it a variant: bytes in the song's
folder, and a line in `variants:` pointing at them. Writing the bytes alone declares nothing —
the scan reads a song's versions from the sidecar and from nowhere else — and a line alone is
what the tree draws as `introuvable`.

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
  two could spell differently is a variant that reads as `missing`.
- **A `variants:` that is not a mapping is refused, not repaired.** A sidecar can say
  `variants:` followed by a list — the scan ignores it (see `readVariants`) — and inserting a
  `key: value` line under that would make the whole file unparseable, which costs the song its
  variants and its provenance. Fix the file on the volume; this will not guess.

The sidecar is edited as **text**, never round-tripped through the YAML serialiser: it carries
comments a person wrote, and a serialiser drops them. The new line goes at the **end** of the block, so the order in the file is the order they were
added. A folder that had no sidecar at all gets one — there is nowhere else the variant could be
declared.

Re-sending a file already declared replaces its **bytes** and nothing else: a second line
pointing at the same `ref` would draw the variant twice. A *different* file whose stem collides
with an existing name gets the next free one (`instrumental 2`), because the block is a mapping
and the second key would otherwise replace the first.

## Where they show up

In the song's own editor, `SongVariants.tsx` — a list beside the waveform, not a row in the
tree. A song's tree row opens straight to that editor on any click, folding nothing: its
`variants:` are never drawn as tree children, so the row has nothing to browse into and no
second target to confuse with the first. Renaming or re-pointing a variant is an edit of
`song.yaml` on the volume: the song's screen edits the master's tags, not the sidecar. The list is
named by the sidecar and not by a file,
because the file it names may not be there — `SongVariants.tsx` says **introuvable** on that row.

**Removing** one is a button on that same row: `removeSongVariant` (write.ts) un-declares the
name in the sidecar, then removes the file it pointed at, so a crash between the two leaves
undeclared bytes rather than a dangling reference. `DELETE /api/mediatek/variant` is it over
HTTP.

## The scan never leaves the song's folder

The catalogue invalidates **one family at a time** — that is what makes a listing cheap, and
`catalogue.ts` says so where the revision token is computed. A song listing that depended on
another listing would serve a stale answer every time that other one changed, and the cache
would have no way to know. So a variant is settled by the dirents already in hand.

## Analysis, and when it runs

A song's master is analysed **at upload**: k7's backend receives the bytes, then asks the chosen
machine to compute the waveform envelope, the transient onsets and the tempo, because it has
no engine and cannot decode audio. The `.cache` sidecar is pushed back beside the audio and the
tempo seeds the master's tags — see `packages/file-service/src/routes/mediatek.ts` and
`packages/file-service/docs/waveformCache.md`.

A **variant** is a file in the folder, so it is analysed the same way and by the same route: it
is a path in the library, and nothing about it is special.

The tempo a variant's analysis finds is written to the MASTER, never to the variant's own file:
`setSongBpm` takes the song's folder, and the tempo describes the morceau — not one version of it.
It does not overwrite one already there.
