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

**The best-rated engine the account may cut on**, chosen here (`src/media/stems/engine.ts`). A cut is a
batch job, so the machine that matters is the fastest one, not the one a page happens to play on: the
rating is the machine's performance score (`packages/web-protocol/docs/performance.md`), an engine
that could not rate itself counting last. Every page that cuts — the songbook, the desk, the editor's
playlist — names none and gets that one. A caller may still name one (`engineId`); it passes the same
rule.

The rule is whose machine it is, since a cut shares the song and the account's models with it:
**the account's own engine** (`owner`, `packages/engine-registry/docs/ownership.md`), **the server's**,
recognised by its render key (`docs/server-engine.md`) — every account's, and the files are already
on its server — or **one the caller holds a claim on**, being the one it drives. An engine merely
shared with the account is someone else's machine: it is chosen only while the caller drives it, and
named otherwise it is a **403**.

It is reached through **its tunnel** — a jobs channel (`packages/engine-tunnel/docs/jobs.md`) — so a
cut works wherever the engine is, not only on this server's network, and an engine with no tunnel
here is never chosen. No engine to cut on is a **409** with `reason: "no-engine"`, rather than a 404:
the remedy is to bring a machine up, and a page says so instead of failing.

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
