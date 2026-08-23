# Cutting a song into stems — the job is this service's

```
POST /api/stems   { song, engineId, chain? }   →   { ready: true, files: [...] }
```

`song` is volume-relative (`songs/<artiste>/<album>/<titre>/original.mp3`, the string every other
route here takes). The stems land in `stems/` under the song's own folder, on **this** volume.

## Why pl8 drives it

Because the bytes are here. Everything else follows from that one fact.

The separation itself cannot happen here — it wants a 166 MB `.onnx`, minutes of CPU and, where
there is one, a GPU, and those are properties of a *machine* rather than of a hosted container. So
the work is borrowed: `cut.ts` posts the master to an engine's `POST /process`, polls, collects the
files and writes them beside the song. The engine keeps nothing.

It used to be the other way round, and that is what this replaces. The engine's file service held a
**scoped mirror** of this library — the songs a set's playlist named, synced every 60 seconds — and
`/stems` separated out of that mirror. Two things were wrong with it, one fatal:

- A mirror must have exactly one writer, and on a dev machine where pl8's `STUDIO_MEDIATEK` was the
  same directory the cache wrote into, it had two. The sync downloaded each file onto itself and
  three songs came back as pure zeros, 40 MB of `0x00`, with no other copy on the machine. The
  diagnosis is written up in the file service's `mediatekPull.ts` and `docs/processChain.md`.
- Even working, it copied whole albums onto a machine so that one song could be cut once.

## One long request, not a job

The engine's `/process` is start-then-poll, because there the waiter is a browser and a job is what
lets it draw a progress bar. Here the waiter is this route, which is *already* sitting on that poll
loop — a second job registry would be bookkeeping over bookkeeping. The caller sees a slow request,
which is exactly what it is.

## Already cut is not work

`cutStems` asks the **folder**: audio in `stems/` means it is done, and the answer is immediate.
Asked of the disk rather than of a record somewhere, for the reason every freshness question in
this repo is asked that way — the files are the truth, and a record beside them is a second one
that can disagree.

## Which engine, and how it is reached

Named by the caller (`engineId`), because it is the engine that browser is already on: this service
has no opinion about which machine is yours. The registry — pl8's own instance — turns the id into
the addresses the engine advertised, and `fileServiceBases` tries loopback first and then each LAN
address in turn. On the dev machine loopback is the only one that means anything, since pl8 and the
engine are the same box.

Authentication is the engine's own token out of the registry plus `x-studio-user`: the same pair
the file service gates every other machine-to-machine call on. A registry **miss** is a 409 rather
than a 404 — the engine existed when the browser picked it, and what to do about it is "bring the
machine back up", not "this URL is wrong".

An engine that **refuses** the cut is reported verbatim rather than treated as an address that did
not answer. A chain that is not there, a model nobody downloaded: those are sentences with a remedy
in them, and retrying the next address would turn each one into "no engine responded".
