# mediatekPull — how a machine keeps up with the médiathèque

The hosted médiathèque owns the songs and samples. `~/.studio/mediatek` on a musician's machine
is a cache of it, because the moteur opens file paths and cannot fetch a URL. `mediatekPull.ts`
is what keeps the two in step, unattended.

> **It used to own the modules too, and this loop used to fetch them.** They live in the
> account's library repository now, mounted per workspace as a git submodule
> (`packages/song/docs/sharedFolders.md`), and `modules` and `chains` came out of `PULLED`
> entirely. The reason is one line of this file's own machinery: `syncFamily` deletes whatever
> the owner's manifest does not list, so pointed at a git checkout it would remove files
> somebody committed. Two writers, one tree. Everything below still describes how the loop
> decides what to fetch and when; where it says `modules`, read `songs`.

Everything it needs already existed and was wired to nothing: `remoteLibrary` (the hosted
service as a `LibrarySource`), `syncFamily` (manifest diff, download to `.part`, rename), and
per-family revision tokens on both sides. This file is the loop that calls them.

## What it fetches: what the open songs name

Not the whole catalogue. `mediatekRefs(project)` reads the project's files — every
`extends: "@st0/…"`, every chain segment naming one, then the closure of what those
modules extend in turn — and each ref becomes the folder prefix
`modules/<type>/<name>/`. A module IS its folder: the jsdsp source, the presets and the panel
travel with `module.yaml`, so the scope is a prefix and never a file list.

The songs in question are the ones **open**: `liveWorkspaces()` is the memo the request path
already maintains, and each workspace's active project is exactly the song someone is working
on. No registry to keep, and nothing walks `~/.studio/root` looking for projects.

## The two reasons to sync

A change token alone is not enough. `familyRevision()` answers "did the library move", which
misses the other half: a song that *starts* naming a module this cache never held changed
nothing on the server. So the loop compares both the owner's token and a signature of the
scope, and syncs when either moved.

Both live in memory rather than in `.cache/manifest/*.rev`. `markSynced` records "this cache
is in step with the owner", and a sync narrowed to four folders has no right to claim that —
a later consumer reading it through `isStale()` would be told a lie. Losing the pair on
restart costs one manifest fetch and no downloads.

## Scoping cuts BOTH sides of the diff

This is the part that has to be right, and it lives in `syncFamily`. `diff(have, want)`
returns everything in `have` that `want` does not mention as `drop`. Filter `want` alone and
every file outside the scope reads as one the owner deleted — the first scoped sync would
empty the cache. So the scope applies to `have` too, and the remembered manifest keeps its
out-of-scope entries untouched, or the next full sync would re-fetch a library that is
already on disk.

## Why it invalidates every workspace's compiled doc

`Workspace.docCache` is memoised and only our own writes clear it. A module landing on disk
is somebody else's write, so without `invalidateProjectDoc()` a freshly fetched module would
sit there behind yesterday's compile — and the timeline would keep reporting the unresolved
reference it was fetched to fix. It also bumps the mutation counter, which is what makes the
browser's 700 ms poll notice and recompile.

## Failure is a missed update, never a broken service

Every error is swallowed and logged **once per distinct message**: a hosted library that is
down would otherwise write a line a minute for as long as it is down. A partial sync stays
stale deliberately — `lastRevision` is only recorded when nothing failed, so the files that
did not land are retried on the next tick.

With no `MEDIATEK_URL` the loop never starts. The local folder is then simply not a cache of
anything, which is a working state: `@st0/…` still resolves against whatever is in it.
