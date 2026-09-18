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

## Why the audio ARRIVES rather than lives here

Taking a path — `songs/<artiste>/<album>/<titre>/original.mp3` — and resolving it **into this
machine's médiathèque cache** is the shape this endpoint exists to avoid. That cache is a scoped
mirror of the hosted library kept in step by a 60-second sync, and a mirror has to have exactly
one writer: where pl8's `STUDIO_MEDIATEK` points at the very directory the cache writes into, the
sync downloads each file onto itself and rewrites songs into tens of megabytes of zeros. The whole
account of it is in [mediatekPull.md](mediatekPull.md).

So the audio does not *live* here. It **arrives**, per job, and leaves with the scratch
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

**`?chain=` is optional, and its default is the machine's.** Which module separates and which
model it wants is one answer per machine — settled once by `system stems`, and asking again at
every use is asking the same person the same question. A caller that does have an opinion should
be able to say so, so the machine's answer is the default rather than the rule.

**`?want=` says WHICH of those answers to fall back to**, `stems` or `instrumental`, and there are
two because they are two chains: the same model, and a module declaring `instrumental` as its
single output instead of the four stems. `system instrumental` holds the second one. A caller
asking for the instrumental over a chain that writes four stems is refused by name rather than
handed four files — collecting those and calling one of them the instrumental is the mistake the
refusal exists for.

**A pass writes what the chain's module DECLARES.** `instrumental` is the one output name that is
not a stem: it means every stem the voice is not, summed while the parts are still in memory. The
alternative — write four files, ship three of them somewhere and add them up — moves hundreds of
megabytes across a network to throw them away.

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
