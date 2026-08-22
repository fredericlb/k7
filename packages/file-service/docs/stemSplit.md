# Splitting a mix into stems

`POST /separate` runs HT-Demucs over an audio file on this machine and writes four 24-bit
WAVs — drums, bass, other, vocals — into `stems/` beside it. It answers with a **job to
poll**, not with audio.

## Why it is a module, and why it cannot be a plugin

A stem separator is the second **cold** module (`@studio/song`'s
[coldModules.md](../../song/docs/coldModules.md)), and it is cold for both reasons that
word covers at once: the answer needs the whole input, and the analysis is affordable once
over a file and hopeless per block.

But it is a shape the normaliser is not — **one input, four outputs** — and that is what
decides everything below. A chain step compiles to a serial insert on one Tracktion track
(`nodeProject.ts`): one buffer in, the same buffer out. There is no fan-out anywhere in
`ProjectDoc`, and the DSP graph has no output port index at all — `GraphBuilder.output()`
takes no port and `DspGraph.cpp` writes one stereo pair. A separator therefore **cannot be
a live plugin**, however the graph is drawn.

So its four outputs are four **files**, and the module says so with
`plugin: { type: offline }` — a third recognised plugin type meaning "no engine plugin; a
pass produces the outputs before the render". It is a word rather than a silence because
the compiler's gate drops any type it does not know, which is how every `jsdsp` module once
vanished from a compile with no warning at all.

The wiring is still real: `graph.yaml` can key a module by its output
(`stemsplit#vocals: [ reverb ]`), the derivation now carries that port along the edge, and
the graph draws a jack per stem. See `@studio/song`'s [ports.md](../../song/docs/ports.md).

## Why a job, when `/render` refuses one

[render.md](render.md) argues against a job registry, and it is still right about a render.
Its own comment named the case that would change the answer:

> `--stems` is not offered here for the same reason: it produces N files, which needs a job
> to hold them, and nothing asks for it.

Something asks now, and a separation scores "job" on every row of
[cloneJobs.md](cloneJobs.md)'s table: **minutes** rather than seconds, a **person** waiting
rather than a server, **four files** rather than one streamable body, and a subprocess with
progress worth reporting.

`separateJobs.ts` is `cloneJobs.ts` with two deliberate differences:

- **The id hashes the WORK** — `(user, source, model)` — not the destination. A clone
  collides over the directory it writes; a separation collides over the *inference*, and a
  retry, a second tab or a remount would otherwise start another hour of arithmetic
  producing byte-identical files.
- **The job carries `files`.** A clone's product is a directory named by `workspace`, so
  there is nothing to list. Four stems are the thing the caller came for, and their names
  come from the model rather than from the request.

## Why 24-bit WAV, and not float or FLAC

The format is decided by the **consumer**, and the consumer changed. While a stem's only
destination was another chain, float32 was the obvious answer: nothing downstream would ever
be worse than the model's own output, so rounding on the way out was a loss taken for nobody.
The desk's four knobs made a stem something a PLATTER opens
([ui-turntables/docs/stems.md](../../ui-turntables/docs/stems.md)), and that reopens the
question.

Tracktion reads WAV, AIFF and its own `FloatAudioFormat` **directly**, and decodes everything
else into a cached proxy first:

```cpp
// tracktion_AudioFile.cpp
needsCachedProxy = dynamic_cast<juce::WavAudioFormat*> (format) == nullptr
                      && dynamic_cast<juce::AiffAudioFormat*> (format) == nullptr
                      && dynamic_cast<FloatAudioFormat*> (format) == nullptr;
```

FLAC therefore reads, and costs a full decode into a second copy the first time a record goes
on — five of them per deck, since the mix and its four stems all land together. A quarter of
the volume saved, paid for at the one moment nobody has time. So the choice is among the
formats that need no proxy, and there 24 bits is simply the small one:

| | one stem, 4 min stereo | the four | thirty songs |
|---|---|---|---|
| float32 (what this wrote) | 85 Mo | 339 Mo | ~10 Go |
| **24-bit** | 64 Mo | 254 Mo | ~7,5 Go |
| FLAC | ~20 Mo | ~85 Mo | ~2,5 Go — behind a proxy |

What 24 bits costs is a quantisation floor at −144 dBFS, and even that is not paid in full: a
cut is `mix − k·stem`, so the stem's own noise enters in proportion to `k` and disappears
entirely with the knob at rest ([dsp/docs/stemcut.md](../../dsp/docs/stemcut.md)). It is not
dithered, for the same order of magnitude — truncation at 24 bits is under the noise of any
converter this will come out of, and dither would put a floor there on purpose instead.

The one thing an integer file cannot do is carry an **overshoot**. The model is not
reconstructing the mix, so nothing holds its output inside ±1; `peakOf` measures each stem
before it is written and the job's `lines` say when one was clamped. Silence would be worse:
the alternative way to learn about it is a click at the loudest moment of the record.

## `POST /stems` — and why it takes no chain

There are two doors, and the second one is what a browser uses. `POST /separate` is per MACHINE
and takes absolute paths, including the model's: a caller that already knows both. `POST /stems`
is workspace-scoped, takes one cache-relative song, and **nothing else**.

The chain it runs is `~/.studio/preferences.yaml`'s `stemsChain`, written once by
`system stems <chaîne>`. That is the shape rather than a shortcut. Which module separates and which
model it wants is one answer for the machine — it does not vary by set list, by project or by
record — so a caller that named one would be asking the same question of the same person at each
use, and the three callers there are (the playlist panel's button, a desk catching up, the verb)
would be three places to get it wrong. A browser cannot resolve it in any case: it has no idea
which `.onnx` this machine holds or where.

The ORDER inside the route is deliberate and testable:

1. confine the path (`safePath`), 404 a song this machine has not pulled;
2. **ask the disk** — a song whose `stems/` already holds audio answers `ready` and starts nothing;
3. *then* read the preference (409 naming `system stems` when there is none);
4. *then* resolve the chain against the open project.

Step 2 before steps 3 and 4 is what lets a machine that has never been told how to separate still
light the knobs on the songs somebody prepared with `playlist stems`.

## Why a worker thread

The file service is **shared**. It serves every workspace on the machine, prewarms
waveforms, polls the médiathèque every 60 s and answers `revision()` every two. An hour of
inference on the event loop would stall all of it.

Every other heavy job in this repo is an out-of-process spawn with a timeout, which buys
that isolation for free. ONNX Runtime lives *in* this process, so a `worker_thread` is what
buys the same property — and the job keeps the handle, so a wedged run can be terminated.

The timeout is an hour. That is not the five minutes `render.ts` uses, because it bounds a
different thing: a render taking five minutes has hung, while a separation taking five
minutes is a long song on a CPU. It is set past any honest run rather than near the
expected one.

## The model

`htdemucs_fp16weights.onnx` — 166 MB, MIT, weights stored fp16. The graph's input is a
**fixed** `[1, 2, 343980]`: stereo, 44.1 kHz, 7.8 seconds. Not a hint — the graph will not
accept another length, which is why `separateAudio.ts` is entirely about reaching exactly
it. The output is `[1, 4, 2, 343980]`, and the stem order is `[drums, bass, other, vocals]`.
Nothing in the tensor says so; `STEMS` is that knowledge, and getting it wrong silently
swaps two stems.

**Where it lives** is the one place this departs from
[moduleAssets.md](../../song/docs/moduleAssets.md). That page argues a module carries its
material so it survives a fork, an upload and a sync — and the argument inverts past a few
hundred megabytes, where `forkSharedModule`'s recursive copy would duplicate the file per
fork, per médiathèque upload and per machine. So the module **declares** the model as an
ordinary file-valued param (`onnx:`, exactly as an amp names `nam:`) and `~/.studio/models`
holds the bytes. `resolveModuleAsset` tries the module's own `assets/` first and falls back
to the cache; a ref that climbs out of `assets/` is still **refused**, never redirected.

## Execution providers

Asked for in order and taken on the first that builds — `dml` then `cpu` on Windows, `cpu`
elsewhere. ORT throws at session creation when a provider is unavailable, so trying is the
only way to find out.

**Which one won is logged** into the job's `lines`. The difference is minutes per song, and
a silent fall back to CPU is indistinguishable from a slow machine.

## What fails hard, and why that is not a contradiction

ffmpeg decodes the input, and here it is a **hard** dependency — which looks like it
contradicts the rule stated in [render.md](render.md) and `@studio/commands/render`, that a
missing ffmpeg costs the FORMAT and never the render.

It does not. That rule holds because there is always a lesser result to fall back to: the
wav. A separation has none — without a decode there is no input, and without the model
there is no output. So each gets its own sentence, the way a missing engine binary does,
and a missing model is a **503** rather than a failed separation: a machine that has not
downloaded a file is a fixable state, and reporting it as a failure sends the reader to
look at their audio.

## Packaging

`onnxruntime-node` is native, and both Node bundles here are esbuilt to a single `.mjs` run
by a vendored Node with no `node_modules` beside it. `external` alone does not fix that —
`fsevents` survives being external only because chokidar has a pure-JS fallback, and ORT has
none. So it is external **and staged** into `resources/node_modules/`, where ordinary Node
resolution finds it. See `engine/capot/scripts/docs/buildEngine.md`.

**macOS is not covered.** Nothing in this repo signs a third-party `.dylib`, so a notarised
`.app` carrying `libonnxruntime.dylib` is unsolved. Windows and Linux bundles carry it.

## The call site

~~What is not wired yet.~~ It is: `clip process <clip> <chain>` over a chain whose step is an
offline module runs this. `mediatekChain` diverts the step instead of resolving it to a plugin,
`coldPass.ts` says which model and whether this machine has it, and `processWithChain` runs the
pass in place of the bounce — no render, no repoint, four files under `stems/`. The rules that
follow (a chain separates or treats, never both; the pass runs before the engine check) are in
`@studio/commands`' [processChain.md](../../commands/docs/processChain.md).

The running still arrives **as a function** for the reason it always did — the inference is here,
in a package that depends on `@studio/commands`, so importing it back would be a cycle. The seam
is `CommandHost.runColdStep`, and this service's implementation is the one place that knows what
"run it" means here: `startSeparate` + poll, so a `clip process` gets the registry's two
properties for free — the id hashes the WORK, so a retry or a second tab joins the run in flight,
and the hour of arithmetic stays on a worker thread while the service answers everything else.

The cost, said out loud: one `/command` request stays open for the length of a separation. The
job registry exists precisely so that a *browser* need not — `POST /separate` is still there and
still start-then-poll — but a command reports what it wrote, and a verb that returned a job id
would be a different verb.

**And a whole set at once** is `playlist stems <playlist> <chain>`, which runs this over every
song a set list names, on this machine's médiathèque cache. It is the preparation half of cutting
a stem live on a deck (`packages/dsp/docs/stemcut.md`): the deck subtracts a stem from the mix it
came out of, so the files have to be there before the record goes on. Sequential, skipping what is
already done, and leaning on the id hashing the work so an interrupted evening resumes for free.
