# Syncing a cache — extended notes

## Two sides, one library

The hosted service owns the library. `~/.lanes/mediatek` on a musician's machine is a
**cache** of it, and it exists because the moteur plays from file paths: it cannot open a
URL, so the bytes have to land on disk whatever the catalogue says.

Both sides are the same shape — a folder — which is why `@studio/mediatek` runs on both
unchanged. The server scans its volume, the cache scans itself, same `scanFamily`, same
`familyRevision`.

## Why the manifest is REMEMBERED, not recomputed

This is the one thing that is easy to get wrong.

A downloaded file has its own mtime — the moment it was written locally, not the moment
the owner last touched it. So comparing a fresh local `stat` against the server's manifest
reports **every file as changed, every time**, and the cache re-downloads the whole library
on every poll.

So `diff(have, want)` takes **two descriptions by the owner**: `want` is what the server
says now, `have` is what the server said when those bytes were fetched, stored beside them.
Local timestamps never enter the comparison.

Concretely, a cache must persist the manifest it last accepted. Losing that file is not
corruption — it just means the next sync re-fetches everything, which is correct if slow.

## Why not the revision token

`familyRevision()` is `mutations:count:mtime`, and it answers "did this family change".
That is the right question for a POLL, and it is what the cache should ask first: cheap on
the server, and it stops the conversation when nothing moved.

It is the wrong question for "what do I fetch", for the same reason as above — the two
sides' tokens are computed over different mtimes and would never agree. The token gates the
sync; the manifest drives it.

## What the manifest does not carry

No content hash. Reading every file to decide whether to read every file costs more than
the thing it guards — the same trade `workspace.ts` makes, written down in index.md.

Size plus the owner's mtime misses a file replaced in place, same second, same length. On a
library whose writes go through one service that bumps a mutation counter, that is a gap the
poll closes rather than the manifest.

## Eviction is not decided here

`diff()` returns `drop` — what the cache holds and the owner no longer has. Whether a cache
should also drop things it simply has not used, and on what budget, is a policy question
with no obvious answer for video, and it is deliberately not answered by this module.
