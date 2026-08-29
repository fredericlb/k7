# Cutting a song into stems — the job is this service's

```
POST /api/stems   { song }   →   { ready: true, files: [...] }
```

`song` is volume-relative (`songs/<artiste>/<album>/<titre>/original.mp3`, the string every other
route here takes). The stems land in `stems/` under the song's own folder, on **this** volume.

## Why pl8 does it, and no longer borrows an engine

Because the bytes are here. Everything else follows from that one fact.

It used to be borrowed: `cut.ts` posted the master at an engine's `POST /process`, polled, and
collected the files back. The argument was that separation wants a 166 MB `.onnx` and minutes of
CPU, which are properties of a *machine* rather than of a hosted container.

**That arrangement could only ever work when pl8 and the engine were the same box.** An engine
advertises a loopback address and its LAN addresses, and nothing else — those are the only ones it
HAS. A hosted pl8 cannot reach either: not a musician's `192.168.x.x`, and certainly not their
loopback. So the borrowing worked on a development machine, where the two are one box, and could
not work in the deployment it was written for. The desktop app made it obvious rather than
introducing it: there, the engine is on the musician's machine by definition.

So the model runs **here**, in a worker thread, and the stems are written straight into the song's
folder. `cut.ts` lost the upload, the poll over HTTP, the collection loop and the scratch cleanup;
what is left is `startSeparate` and a loop redrawing its progress. `engineId` left the route
contract with it.

The cost is real and worth stating: `onnxruntime-node` — a native dependency — and the model are
now in this service's closure, and a cut spends minutes of the container's CPU. The queue below is
the answer to the second half.

## Which model

There is no chain to resolve one from. The chain machinery exists so a musician's machine can name
one of its own modules, and this service has no libraries checkout and no per-user modules; a
hosted container has one model, or none. `model.ts`:

- `STUDIO_STEMS_MODEL` names one outright, and must be absolute — a relative path would resolve
  against the server's working directory, which is not something an operator can see.
- Otherwise `STUDIO_MODELS_DIR` (default `<volume>/.models`) must hold **exactly one** `.onnx`.

Two is **refused rather than guessed at**, and that is the whole reason the rule is written this
way: the wrong model separates a song into four files that are silently the wrong four, and nothing
downstream — not the folder, not the scan, not the player — can tell. A server with no model at all
answers **503 with the directory named in the sentence**, which is a fixable state rather than an
error.

The model is checked when the request arrives, not when the job runs, so a server without one says
so immediately instead of queueing a cut that cannot start.

## One cut at a time

`queue.ts`. A separation is minutes of CPU with the model resident, and this process serves every
other request in the image beside it — two at once make both slow and the catalogue slow with them.
So one runs and the rest wait.

The wait is drawn onto the job the poller **already** reads (`withWait`), so a queued cut and a
running one are one shape and the browser needs no second concept: `phase` becomes `queued · next`
or `queued · 2 ahead`. `percent` is cleared rather than left at zero, because a bar sitting at 0 %
for ten minutes reads as a hang where the words read as what it is.

The slot is freed in a `catch` **before** the `finally`, and that order is load-bearing: `finally`
passes a rejection on, so without the catch a run that throws would free the slot and then bring
the process down on an unhandled rejection. One bad song must not stop the queue.

## Already cut is not work

`cutStems` asks the **folder**: audio in `stems/` means it is done, and the answer is immediate.
Asked of the disk rather than of a record somewhere, for the reason every freshness question in
this repo is asked that way — the files are the truth, and a record beside them is a second one
that can disagree.

The same rule catches a job the registry swept. A finished job is kept five minutes; a poller that
misses that window asks the folder rather than reporting a failure, because a swept job is
overwhelmingly one that landed.

## `stems/`, never beside the master

The scan takes the **first** audio file in a folder and does not descend, so a stem dropped
alongside the master could be played in place of the mix. `@studio/song-schema`'s `stems.ts` holds
that rule for everyone, and `cut.ts` writes under `dirname(safePath(song))` — `dirname` and not a
slice on `"/"`, because `safePath` answers in the platform's own separators and a hand-rolled
split would put `stems/` at the volume root on Windows.

## The shape the browser reads

`SeparateJob`, the same one the file service answers with, so a browser reads a cut the same way
wherever it ran — which is what let the engine be taken out from under it without touching the
poller. Progress is forwarded from the worker verbatim: phase, percent, its own tail of lines.

The poll is twice a second, and in-process, so it is only how often the progress is redrawn rather
than a network round trip. The hour-long cap lives in `@studio/stem-separation` with the worker it
guards; this service no longer has a timeout of its own, because there is no longer anything
between it and the work.
