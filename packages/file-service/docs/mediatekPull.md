# mediatekPull — how a machine keeps up with the médiathèque

The hosted médiathèque owns the songs and samples. `~/.studio/mediatek` on a musician's machine
is a cache of it, because the moteur opens file paths and cannot fetch a URL. `mediatekPull.ts`
is what keeps the two in step, unattended.

> **`PULLED` is `songs` and nothing else.** Modules and chains live in the account's library
> repository, mounted per workspace as a git submodule
> (`packages/song/docs/sharedFolders.md`), and they must never be a family here: `syncFamily`
> deletes whatever the owner's manifest does not list, so pointed at a git checkout it would
> remove files somebody committed. Two writers, one tree.

It is built out of three pieces: `remoteLibrary` (the hosted service as a `LibrarySource`),
`syncFamily` (manifest diff, download to `.part`, rename), and per-family revision tokens on
both sides. This file is the loop that calls them.

## What it fetches: what the open projects name

Not the whole catalogue. `mediatekSongRefs(project, root)` reads the project and the workspace
around it for the songs a set list names, and each ref becomes a folder prefix
(`songs/<artiste>/<album>/<titre>/`). A song IS its folder — the masters and the sidecars travel
together — so the scope is a prefix and never a file list.

The projects in question are the ones **open**: `liveWorkspaces()` is the memo the request path
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

`Workspace.docCache` is memoised and only our own writes clear it. A file landing on disk
is somebody else's write, so without `invalidateProjectDoc()` a freshly fetched song would
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

## The vocabulary `scope()` reads

A SONG ref carries its family (`@st0/songs/a/b/c` → `songs/a/b/c/`), which is what
`songPathPrefix` turns into a folder prefix — a MODULE ref, which omits its family, is a
different vocabulary and has its own function. The songs are a set's PLAYLIST, and they are the
reason this loop matters at all off the desk: the machine that plays them opens file paths, so
every song in the set has to be on its disk before the gig. Samples are fetched per clip, not by
this loop.

The workspace ROOT goes down with the project directory: a playlist lives beside `_modules` at
the top of the repository rather than inside the project
(`packages/song/docs/playlists.md`), so answering "what does this set name" needs both halves.
`mediatekSongRefs` is where the two meet, and the only place they do.

Nothing open naming the library means no fetch AND no token recorded — otherwise the first song
that did name one would be told everything was already in step.

## `syncMediatekFamily` — a WHOLE family, ignoring the scope

What the module bench needs and nothing else does. `pullOnce` fetches only what the open projects
name, which is the right default and the reason this cache stays small. The bench names nothing:
its whole content is the catalogue, so the scoped pull would leave it holding whatever happened
to be cached for other songs.

It deliberately does NOT record a revision — `markSynced`'s claim is "this cache is in step with
the owner", and that is not true for the songs the scoped loop pulls. It drops the scoped loop's
memo entry instead, because that memo records a SCOPE alongside the revision and this pass had
none; dropping it makes the next tick re-decide rather than skip. Never throws, same as
`pullOnce`: an unreachable library must cost the refresh, not the open.

## The loop is STOPPED, and why

`startMediatekPuller` returns immediately. The guard is a stopgap rather than the design: the
médiathèque cache is on its way out (the stem cut moves to pl8, which already holds the bytes),
and until it goes this loop must not run.

What it does when it runs: where `STUDIO_MEDIATEK` for pl8's backend is `~/.studio/mediatek` —
the very directory this cache writes into (`env.yaml`) — every tick downloads each scoped file
ONTO ITSELF and renames the copy over the original while the server is still serving it. Songs
come back as pure zeros, 3.4 MB and 37 MB of `0x00`, with no other copy of them on the machine.

It cannot settle, either: `syncFamily` records the manifest entry's mtime, and its own rename
gives the file a NEW one, so the next diff always mismatches. Nine files rewritten every sixty
seconds, indefinitely.
