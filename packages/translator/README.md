# @studio/translator

Converts another DAW's project into a l8 **node project** — a folder of YAML the
`@studio/song` loader reads back. Two formats today:

```
 *.dawproject ──┐
                ├──(translator)──► node project ──(l8 graph)
 *.als ─────────┘
```

Pure offline converters: they never talk to the engine or the WebSocket. Their only
contract is the folder layout `@studio/song` reads.

## Use

A **library**, consumed as raw TS source like the other `packages/*` — no `bin`, no
`main()`. Its API, by subpath export:

```ts
import type { Song, Translation } from "@studio/translator/model";     // the neutral shape
import { parseDawproject } from "@studio/translator/dawproject";       // bytes  -> Translation
import { parseAls } from "@studio/translator/ableton";                 // bytes  -> Translation
import { resolvePluginParams } from "@studio/translator/params";       // presets -> text params
import { emitFolder } from "@studio/translator/emit";                  // Song   -> the YAML folder
```

Every mapper returns the same `Translation`, so only the first step knows a format.
`packages/file-service`'s `importProjectInto` is the caller: it dispatches on the file
extension and is reached from l8 by clicking the file in the tree.

`resolvePluginParams` takes the engine binary as an argument — locating it is the caller's
job (`@studio/engine-client/engineBinary`), so this package never guesses where the repo is.
`parseAls` likewise takes a `readSample` callback: a `.als` does not embed its audio, and
the mappers do no disk I/O.

Produces a self-contained folder:

```
outDir/
  project.yaml               header (name/tempo/sampleRate/timeSignature)
  graph.yaml                the graph: track → module nodes → OUT
  modules/io/OUT/module.yaml            the stereo-output sink (io module)
  modules/{instruments,audio,transformers}/<name>/module.yaml
                                        self-contained modules: the plugin inline +
                                        concrete params (deduped by plugin+params),
                                        with <name>.vstpreset beside them
  tracks/<name>.yaml         arrangement: positioned clips/sequences + settings
  clips/<id>.yaml (+.wav)    raw audio material (source only; placement is on the track)
  sequences/<id>.yaml        raw MIDI material (inline {t,d,k,v} note structs)
```

No schema ships with it: a project is validated in process against the loader's own
schemas (`packages/song/src/yaml/`).

## What it maps

- tempo, time signature, sample rate, project name
- each source track → a `tracks/` **arrangement** (name/volume/pan/mute + positioned
  clips/sequences with begin/end/offset/fades)
- audio clips with their **warp markers**, carried all the way into the C++ engine
- MIDI clips as sequences — notes inline at full fidelity (exact onset/duration/key/velocity)
- **plugin chains → chain-node graphs**: a track's ordered inserts (instrument first, then
  audio FX) become `track → p0 → p1 → … → OUT`, each step `use`-ing a self-contained
  **module** (a deduped plugin + its params) carrying its `.vstpreset`
- DAWproject only: **sends → bus subbranches**; effect/return tracks become `from`-less
  chains ending at OUT, and an enabled send makes a track's terminal fan out to OUT + the bus
- master track → OUT (or a master chain if it carries plugins)

## What it drops

Automation curves, and cross-type plugin chain order is approximated (instrument/note FX
before audio FX). Send **levels** are lost even where sends are carried: `graph.yaml`
records destinations, not gains, and the emitter writes a `NOTE:` saying so.

Ableton additionally drops what has no portable form — Live's own devices, rack structure,
sends and returns, group tracks, Session view clips and track colours — each **named in the
import log** rather than dropped quietly. See `docs/import.md`, which is also where the
non-obvious `.als` readings are written down; it is worth reading before touching
`ableton.ts`.
