# `POST /process` — run a chain over audio somebody sends you

```
POST /process?chain=@st0/stems&name=original.mp3   ← the bytes, in the body
GET  /process/:id                                   ← where it got to
GET  /process/:id/file?name=vocals.wav              ← one result
DELETE /process/:id                                 ← the caller has them; drop the scratch
```

The caller is **pl8**. It holds the masters, so it owns the job: it posts a song's bytes, polls,
collects the files, and writes them onto its own volume. This machine lends its model and its CPU
and keeps nothing.

## Why it exists, when `/stems` already did

`/stems` took a path — `songs/<artiste>/<album>/<titre>/original.mp3` — and resolved it **into
this machine's médiathèque cache**. That is the line this endpoint exists to delete. The cache was
a scoped mirror of the hosted library kept in step by a 60-second sync, and on a machine where
pl8's `STUDIO_MEDIATEK` pointed at the very directory the cache wrote into, that sync downloaded
each file onto itself and rewrote three songs into 40 MB of zeros. The whole account of it is in
`mediatekPull.ts`'s docblock; the short version is that a mirror has to have exactly one writer and
this one had two.

So the audio no longer *lives* here. It **arrives**, per job, and leaves with the scratch
directory.

## Three decisions

**The bytes come in the body.** Not a URL for this service to fetch back: that would need a
credential for pl8 on every musician's machine, pointing the dependency the wrong way round — the
hosted library would become something the engine machine authenticates against in order to do work
*for* it. One hop, one direction. The body is streamed to disk rather than buffered, for the reason
`remoteLibrary.download` already gives: a master is routinely tens of megabytes and must never be
held whole in memory on the way through.

**The chain is resolved against the LIBRARIES, not a project.** `resolveChain` wants a project
directory and reaches the libraries at `../_libraries`, but pl8 has no project and no workspace —
it is not that kind of client. `librariesAnchor` answers with a path under any of the account's
workspaces, and *any* is exact rather than approximate: the libraries are a submodule of the one
library repository the account owns, mounted identically in every workspace. Two clones that
disagreed would be two checkouts of one remote at different commits, which is a sync problem and
not an ambiguity about what `@st0/stems` means.

**`?chain=` is optional, and its default is the machine's.** `/stems` never let a caller name one
at all, on the argument that which module separates and which model it wants is one answer per
machine — settled once by `system stems`, and asking again at every use is asking the same person
the same question. That still holds. But pl8 now knows *which song*, and a caller that does have an
opinion should be able to say so, so the machine's answer became the default rather than the rule.

## What it does not do yet

A chain either **separates** or **bounces**; `resolveChain` refuses one that does both, because a
step after a separator would have four inputs and no way to name one. Only the separating half is
wired here. A bouncing chain is refused **by name** rather than accepted and quietly producing
nothing — the sentence says how many modules it found and what this endpoint runs.

## The scratch directory

One per run, under the system temp dir, holding the mix that arrived and the files it produced.
It is dropped three ways, and it needs all three: on `DELETE` (the collector is the only thing that
knows it is finished), on a sweep an hour later (a caller that crashed mid-collection), and
immediately when the request fails before the job starts.

The job registry itself is `@studio/stem-separation`'s `separateJobs.ts`, shared with `/separate` — same worker, same polling,
same hash-of-the-work id. Two callers asking for the same cut therefore share a directory, which is
right: it is the same files. That is also why the map is keyed by job id rather than derived from
it — a second request for work already in flight gets the first run's directory, and its own is
dropped rather than left behind.
