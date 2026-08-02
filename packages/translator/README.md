# @studio/translator

Converts a [DAWproject](https://github.com/bitwig/dawproject) file into a
lanes **node project** (all-CUE). Pure offline converter — it never talks to
the engine or the WebSocket; its only contract is the folder layout / CUE schema
that `@studio/song` reads.

```
 *.dawproject ──(translator)──► node project ──(lanes graph)
```

## Use

A **library**, consumed as raw TS source like the other `packages/*` — it has no
`bin` and no `main()`. Use it programmatically to convert DAWproject files to CUE folders.

Its API, by subpath export:

```ts
import { parseDawproject } from "@studio/translator/dawproject"; // bytes  -> Song + assets
import { resolvePluginParams } from "@studio/translator/params"; // presets -> text params
import { emitFolder } from "@studio/translator/emit";            // Song   -> the CUE folder
```

`resolvePluginParams` takes the engine binary as an argument — locating it is the
caller's job (`lanes import` uses `@studio/engine-client/engineBinary`), so
this package never has to guess where the repo is.

Produces a self-contained folder (default: `./My Song/` next to the input):

```
outDir/
  schema.cue                 the node CUE schema (portable; validation + completion)
  project.cue                header (name/tempo/sampleRate/timeSignature)
  chains.cue                 the graph: track → module nodes → OUT
  modules/io/OUT/module.cue             the stereo-output sink (io module)
  modules/{instruments,audio,midi}/<name>/module.cue
                                        self-contained modules: the plugin inline +
                                        concrete params (deduped by plugin+params)
  tracks/<name>.cue          arrangement: positioned clips/sequences + settings
  clips/<id>.cue (+.wav)     raw audio material (source only; placement is on the track)
  sequences/<id>.cue         raw MIDI material (inline {t,d,k,v} note structs)
  plugins/*.vstpreset        plugin state (written beside each module)
```

Inspect it — point the brain at the **folder** (needs the `cue` CLI on PATH).

## What it maps

- tempo, time signature, sample rate, project name
- each source track → a `tracks/` **arrangement** (name/color/volume/pan/mute +
  positioned clips/sequences with begin/end/offset/fades)
- audio clips — nested container/leaf clips flattened to absolute beat
  positions (`start = container.time + clip.time − container.playStart`)
- MIDI clips as sequences — notes emitted inline in the `.cue` as compact
  `{t,d,k,v}` structs at full fidelity (exact onset/duration/key/velocity)
- **plugin chains → chain-node graphs**: a track's ordered inserts (instrument
  first, then audio FX) become `track → p0 → p1 → … → OUT`, each step `use`-ing a
  self-contained **module** (a deduped plugin + its params) carrying its
  `.vstpreset` (bypassed plugins keep `enabled: false`)
- **sends → bus subbranches**: effect/return tracks become `from`-less chains
  ending at OUT; an enabled send makes a track's terminal fan out to OUT + the bus
- master track → OUT (or a master chain if it carries plugins)

## What it drops (v1)

Warps/time-stretch, plugin parameter values (only the `.vstpreset` path is
carried, not parsed), and automation curves. Cross-type plugin chain order is
approximated (instrument/note FX before audio FX). MIDI notes are now carried at
full fidelity (see above). The structural essentials above are carried so nothing
important is lost.
