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

The other arrangement — mirroring this library onto the engine's machine and separating out of
the mirror — is the one to keep refusing, for two reasons, one of them fatal:

- A mirror must have exactly one writer, and on a dev machine where pl8's `STUDIO_MEDIATEK` is
  the same directory the cache writes into, it has two. The sync downloads each file onto itself
  and songs come back as pure zeros, 40 MB of `0x00`, with no other copy on the machine. The
  diagnosis is written up in the file service's `mediatekPull.ts` and `docs/processChain.md`.
- Even working, it copies whole albums onto a machine so that one song can be cut once.

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

**Both of those addresses are private, and that bounds where a cut can happen.** An engine
advertises its loopback and its LAN IPv4s and nothing else — they are the only addresses it has —
so this service can only borrow one when it is on the same box or the same network. pl8 and the
engine together on a musician's machine is the case this route is for; a pl8 that is not there
reports that no address answered, and the remedy is to run the cut from a machine that can see the
engine rather than to move the model into this container. What that would cost is a native
dependency and a 166 MB model in the closure of the service that also serves the catalogue, and
minutes of its CPU per song — the paragraph above is the reason it is not paid.

Authentication is the engine's own token out of the registry plus `x-studio-user`: the same pair
the file service gates every other machine-to-machine call on. A registry **miss** is a 409 rather
than a 404 — the engine existed when the browser picked it, and what to do about it is "bring the
machine back up", not "this URL is wrong".

An engine that **refuses** the cut is reported verbatim rather than treated as an address that did
not answer. A chain that is not there, a model nobody downloaded: those are sentences with a remedy
in them, and retrying the next address would turn each one into "no engine responded".

## `stems/`, never beside the master

The scan takes the **first** audio file in a folder and does not descend, so a stem dropped
alongside the master could be played in place of the mix. `@studio/song-schema`'s `stems.ts` holds
that rule for everyone, and `cut.ts` writes under `dirname(safePath(song))` — `dirname` and not a
slice on `"/"`, because `safePath` answers in the platform's own separators and a hand-rolled
split would put `stems/` at the volume root on Windows.

## The bytes travel once, and come back streamed

The master goes up **in the request body**: the engine holds no copy of this library, which is the
whole point of driving the cut from here, so it travels once per job and is thrown away with the
scratch directory afterwards. The stems come back one at a time, piped straight to disk — four
stems of a long song are hundreds of megabytes, and this process is serving everybody else's
requests while it happens. The final `DELETE` is best-effort: the files are here now, and an engine
that never hears it sweeps on its own an hour later.

Progress is forwarded **verbatim** — phase, percent, the worker's own lines — because this service
is a pipe for the engine's progress rather than a second opinion. The one phase of its own is
`collecting`, named because it is minutes for a long song over a LAN and an unlabelled gap at 100 %
reads as a hang.

The poll is every two seconds, which a job measured in minutes never feels. The 90-minute cap is
past any honest run and exists only to catch an engine that stopped answering at all — the engine
has its own, shorter one for a separation that merely takes too long.
