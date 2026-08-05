# Splitting a mix into stems

`POST /separate` runs HT-Demucs over an audio file on this machine and writes four WAVs —
drums, bass, other, vocals — into `stems/` beside it. It answers with a **job to poll**,
not with audio.

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

The wiring is still real: `chains.yaml` can key a module by its output
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

## What is not wired yet

The **call site**. `coldPass.ts` in `@studio/commands` decides which steps are offline and
refuses early; `mediatekChain` is where an offline module must be diverted rather than
pushed onto the plugin list, and that diversion is the remaining line. The running arrives
as a function on purpose — the inference is here, in a package that depends on
`@studio/commands`, so importing it back would be a cycle.
