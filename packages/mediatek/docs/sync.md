# Syncing a cache — extended notes

## Two sides, one library

The hosted service owns the library. `<state>/mediatek` on a musician's machine is a **cache** of
it, and it exists because the moteur plays from file paths: it cannot open a URL, so the bytes
have to land on disk whatever the catalogue says.

Both sides are the same shape — a folder — which is why `@studio/mediatek` runs on both
unchanged. The server scans its volume, the cache scans itself, same `scanFamily`, same
`familyRevision`.

## Why the manifest is REMEMBERED, not recomputed

This is the one thing that is easy to get wrong.

A downloaded file has its own mtime — the moment it was written locally, not the moment the owner
last touched it. So comparing a fresh local `stat` against the server's manifest reports **every
file as changed, every time**, and the cache re-downloads the whole library on every poll.

So `diff(have, want)` takes **two descriptions by the owner**: `want` is what the server says
now, `have` is what the server said when those bytes were fetched, stored beside them. Local
timestamps never enter the comparison.

Concretely, a cache must persist the manifest it last accepted. Losing that file is not
corruption — it just means the next sync re-fetches everything, which is correct if slow.

## Why not the revision token

`familyRevision()` is `mutations:count:mtime`, and it answers "did this family change". That is
the right question for a POLL, and it is what the cache asks first: cheap on the server, and it
stops the conversation when nothing moved.

It is the wrong question for "what do I fetch", for the reason above — the two sides' tokens are
computed over different mtimes and would never agree. The token gates the sync; the manifest
drives it.

## What the manifest does not carry

No content hash. Reading every file to decide whether to read every file costs more than the
thing it guards — the same trade `workspace.ts` makes, written down in index.md.

Size plus the owner's mtime misses a file replaced in place, same second, same length. On a
library whose writes go through one service that bumps a mutation counter, that is a gap the poll
closes rather than the manifest.

## `scope` narrows BOTH sides of the diff

`syncFamily` takes a `scope` predicate, for a cache that holds what its songs reach for rather
than the whole catalogue. It is applied to `want` **and** to `have`, and that is the part that
has to be right: scoping `want` alone would make every file outside the scope look like one the
owner had dropped, and the first partial sync would delete the rest of the library. Everything
out of scope keeps its remembered entry untouched.

The remembered manifest is written **last**, reflecting only what actually landed: a crash
mid-sync means the next one re-fetches, which is the safe direction. `markSynced` is only called
for a sync that failed nothing, so a partial sync stays stale and the missing files are retried.

## Eviction lives next door

`diff()` returns `drop` — what the cache holds and the owner **no longer has**. That is a
different question from "what can this disk afford", which `docs/eviction.md` answers: a
per-family byte budget, least-recently-fetched first, `modules` never evicted, and nothing
automatic.

One thing from that page belongs here too, because it is really a fact about *this* one: eviction
has to rewrite the remembered manifest. Deleting bytes without forgetting them leaves a cache
that believes it still holds a file for ever — `diff()` compares against the memory, not the
disk, which is the whole point of the section above.

## A download goes through `.part`

`download()` writes to `<dest>.part` and renames at the end. The destination is the machine's
médiathèque cache — exactly the files the decks open and the engine decodes — and a truncated
master installed there is worse than a missing one: nothing says it is short, it plays until it
stops. The rename is atomic on one filesystem, so what appears under the real name always
arrived whole; a failure leaves nothing at all.

## `terminated` says nothing, and the format is at fault

`fetch` reports a transport failure in two words — `fetch failed` or `terminated` — and files the
real reason in `cause`. A caller that settles for `e.message` therefore surfaces one word that
can mean six things: "analysis impossible: terminated", in a browser, about a download between
two servers.

`why()` flattens the `cause` chain into the message, because the message is the only field that
survives the trip back through HTTP to a browser:

```
mediatek GET https://st0.priv.frediver.se/api/mediatek/file songs/…/original.flac:
  terminated ← other side closed (UND_ERR_SOCKET)
```

The address is part of it deliberately: `MEDIATEK_URL` is **derived** rather than configured (see
`mediatekUrlFor` in `@studio/engine-host`), so "which médiathèque did it even try" is half the
answer every time the answer is "the wrong one".

| cause | what happened |
|---|---|
| `other side closed (UND_ERR_SOCKET)` | the host closed before the announced body ended — often a service restarted mid-download, which `tilt` does on every save |
| `unable to verify the first certificate` | an authority node does not know — a local private-CA proxy in front of the service |
| `ECONNREFUSED` | nobody is listening at that address |
| `UND_ERR_BODY_TIMEOUT` | the body stopped arriving without the connection dropping |

There is **no** retry: a master download is long, and retrying silently would turn a visible
cause into twice the wait. The `.part` does make a retry safe, if use ever asks for one.
