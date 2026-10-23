# Cutting a song into stems — the job is the library's, the work is the engine machine's

```
POST /api/stems   { song, engineId, chain?, want? }   →   { ready: true, files: [...] }
```

`want` is `stems` (the default) or `instrumental` — the four parts a deck plays, or the record
without its voice, which is one file the chain sums rather than three this backend would have to
add up. Both land in the same `stems/` folder.

`song` is volume-relative (`songs/<artiste>/<album>/<titre>/original.mp3`, the string every other
route here takes). The stems land in `stems/` under the song's own folder, on **this** volume.

## Why the library drives it, and why it does not run it

The library drives it because the bytes are here: the job, its progress and its result are this
backend's.

It does not RUN it: the separation wants a 166 MB `.onnx`, minutes of CPU and, where there is one,
a GPU — properties of the machine an engine runs on, not of a hosted container, which on Alpine
has no build of the runtime at all. So the cut runs on the chosen engine's machine
(`packages/stem-separation/docs/stemSplit.md`), and this backend borrows it.

## Which chain: the account's

Which model a cut runs is read off a chain of the account's library — the one the caller names, or
the account's standing `system stems` / `system instrumental` answer. The account's file service is
what holds the library clone and those answers, so `cutStems` asks it (`FileHub.coldRun`) rather
than resolving anything here. A missing chain, a chain that does not separate, one that writes no
instrumental: each is a sentence with a remedy, reported verbatim.

## Which engine, and how it is reached

Named by the caller (`engineId`), because it is the engine that browser is already on: this backend
has no opinion about which machine is yours. It is reached through **its tunnel** — a jobs channel
(`packages/engine-tunnel/docs/jobs.md`) — so a cut works wherever the engine is, not only on this
server's network. The caller must hold a claim on that engine, or the cut is a **403**: anyone may register an
engine, and a cut shares the song and the account's models with its machine
(`packages/engine-registry/docs/claim.md`). The server's own engine is the exception, recognised by its
render key (`docs/server-engine.md`): every account may use it, and the files it would be lent are
already on its server, so a page that drives no engine — the songbook's "Make instrumental" — cuts on
it with no claim. An engine with no tunnel here is refused by name. A registry **miss** is a 409
rather than a 404: the engine existed when the browser picked it, and the remedy is to bring the
machine back up.

## The files travel as the tunnel moves them

The channel shares this volume **writable** and the account's `models/` and workspaces
**read-only**. The master and the model are copied onto the machine before its handler sees the
request — the model once per machine, not once per song — and each stem is on this volume, in
`stems/`, before the reply naming it arrives. Nothing is posted, polled or collected by hand, and
nothing of this library is mirrored anywhere a cut did not need.

Progress is forwarded **verbatim** — phase, percent, the worker's own lines — because this backend
is a pipe for the machine's progress rather than a second opinion.

## Already cut is not work

`cutStems` asks the **folder**, and it asks for what THIS caller wants: the four stems complete, or
`instrumental.wav` there. One question for both would answer "done" to a request for the
instrumental because somebody once cut the stems, and hand back four files that are not it.
Asked of the disk rather than of a record somewhere — the files are the truth, and a record beside
them is a second one that can disagree.

## `stems/`, never beside the master

The scan takes the **first** audio file in a folder and does not descend, so a stem dropped
alongside the master could be played in place of the mix. `@studio/song-schema`'s `stems.ts` holds
that rule for everyone, and `cut.ts` writes under `dirname(safePath(song))` — `dirname` and not a
slice on `"/"`, because `safePath` answers in the platform's own separators.
