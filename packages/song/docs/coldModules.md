# Cold modules

A **cold** module only works on audio that is already on disk. It says so itself:

```yaml
# modules/cold/normalize/module.yaml
cold: true
plugin: { type: jsdsp, name: Normalize }
```

## Filed under `cold/`, and never suggested

A cold module lives in its library's **`cold/`** type folder (`@st0/cold/normalize`), with audio in
and audio out like `audio/`; a separator still names its own outputs. The folder is what keeps it
out of the module picker and the chain completions (`baseModuleRefs`, `projectHints`). Offered
there, it would be refused the moment it was wired to a lane, which is where nearly every pick
lands. What places one is what already knows it has a whole file: a set's scaffold puts the tempo on
each deck, and a médiathèque chain template puts a separator on a song's master. The Libraries tab
still lists them, so they can be edited.

The folder files a cold module; `cold: true` is still the fact the placement rule reads, and it is
inherited, so `instrumental` is cold because it extends `stemsplit`.

## What "cold" means, and what it does not

Not "expensive". A cold module run live would not be slow — it would be **wrong**, because the
answer does not exist yet.

Normalisation is the plain case. The gain it applies depends on the loudest sample of the
recording, and the loudest sample may be the last one. There is no partial answer to give while
the file is still arriving: a streaming normaliser that guesses from what it has heard so far is
a compressor, which is a different effect with a different name.

The second reason a module might be cold is cost — an analysis that is affordable once over a
file and hopeless per block. Both reduce to the same requirement, which is why one word covers
them: the input has to be knowable in full, ahead of time.

## The rule

**A cold module's chain must draw its signal from a file input** (`io: file`).

Not merely "not live". A track is not enough: a chain fed by a lane is fed by whatever that lane
plays, decided at playback. A file is the only source whose whole length is knowable before
anything runs, and the whole point of the flag is that the whole is what the module needs.

That is why cold modules belong in the **médiathèque's chain templates** — those run over a
song's master file, and a template's generic `@in` becomes exactly that `io: file` input when it
is applied (see `@studio/mediatek`'s `docs/chains.md` and this package's `docs/fileInput.md`).

## Where the rule is enforced

`coldPlacementError` in `graph.ts`, and nowhere else. Every surface that can add a module to a
chain calls it — `node insert` and whatever the chain views wire to it —
because a rule enforced in two places is a rule that will be enforced differently in one of them.

Three things about how it is asked are deliberate:

- **Before anything is written.** `node insert` creates the module and then splices it in; the
  refusal has to come first, or a rejected drop leaves a folder behind. So the check takes the
  module (or the ref it is about to extend) rather than looking it up by the name it will have.
- **Arriving wired to NOTHING is allowed.** `node new` drops a node in connected to nothing.
  There is no input yet to be wrong about, and refusing there would mean refusing to write a
  module you are about to give a file to. The refusal comes when it is wired.
- **The message says what to do**, not only that it refused — a live input has no "whole" yet,
  so the fix is a file source or a médiathèque chain over a song.

## `cold` is inherited

It is a fact about what the module IS, so it is **not** in `moduleResolve`'s `OWN_ONLY`: a use of
a cold module is cold, and a node that states only its `Target` does not have to restate it.
That is the same reason `plugin` is inherited and `category` is not.

## The normaliser

`@studio/dsp`'s `normalize()` is the first one, and its graph is four nodes:

```
sub(Target, Peak) -> clamp(-60, 30) -> fromdb -> gain
```

**The graph being trivial is the point.** Applying the gain is one node; knowing which gain
cannot be expressed here at all. So `Peak` is an *input* to the graph — a parameter, because that
is how a measured fact reaches a graph — filled in by the pass that reads the file end to end.

Two defaults carry the safety:

- `Peak` defaults to **0 dBFS**, so with no pass having run the module attenuates by `Target` and
  can never boost. Wrong in the harmless direction.
- The gain is **clamped to +30 dB**. Near silence measures -100 dBFS and would otherwise ask for
  +99 dB, turning hiss into a full-scale roar.

A normaliser module is `module.yaml` plus the `jsdsp.ts` that mirrors `@studio/dsp`'s
`normalize()` graph — the same arrangement the crossfade uses. It is authored into the account's
library under `modules/cold/`, this repo holding no modules to copy from
([sharedFolders.md](sharedFolders.md)).

## Cold modules come in two shapes

The normaliser **measures**: the pass reads the file and writes a number back into a param
(`Peak`), and the module's own graph then applies it. That is one shape.

A stem separator is the other. It does not produce a number for a graph to use — it produces
**four audio files**, and it has to, because a chain step compiles to a serial insert on one
Tracktion track and there is no fan-out in `ProjectDoc` at all. So it says
`plugin: { type: offline }`: no engine plugin, and a pass writes its outputs before the render.
See `@studio/file-service`'s `docs/stemSplit.md`.

Both are cold for the same reason and obey the same rule — the input has to be knowable in
full — which is why one word still covers them. What differs is what the pass hands back.

### The tempo module is the second producing one

The `tempo` module changes a song's BPM, and it is `offline` for a reason worth
stating because it is not the stem splitter's: it does not fan out, it simply cannot be a
plugin at all. **The engine hosts no time-stretch.** `PluginScan.cpp` registers a Pitch
Shifter and nothing that moves the clock — Tracktion stretches a CLIP, through warp markers,
not through an insert. A graph of primitives cannot express it either. So the only shape
left is a pass that writes stretched audio to disk.

Its params mirror the normaliser's exactly: `Source BPM` is MEASURED (0 until the pass has
run, which makes the module a no-op rather than a stretch by a made-up ratio) and
`Target BPM` is AUTHORED. Same two roles, same harmless default — and its `ui.yaml` draws
them the same way round: a knob for the one you choose (10..300 BPM), a meter for the one
that is read. The knob cannot express 0, which is the untouched state; the panel draws it at
the floor until the pass measures a tempo or somebody asks for one.

It is what the desk puts on each deck — a deck's source being a file is precisely what makes the
placement legal. See `packages/song/docs/setProject.md`.

### What `offline` actually promises

Reading it as "a pass writes files to disk" is too narrow. `offline` says one thing:
**there is no engine plugin, and the module is made true outside the graph.** The compiler
acts on exactly that — `nodeProject` skips emitting a plugin, and nothing more.

*How* it is made true is the module's own business, and there are two shapes so far:

| module | realised by |
|---|---|
| `stemsplit` | a pass writing four files before the render |
| `instrumental` | the same pass, summing what it separated into one file |
| `tempo` | the PLAYER time-stretching the clip it feeds |

What a producing module WRITES is what it declares as outputs: the four stems, or `instrumental`
— the one output name that is not a stem, meaning every stem the voice is not. So asking for a
record without its voice is a module and a chain rather than a flag, and the two chains differ by
that single line.

The tempo's is not a stand-in for a pass that ought to exist. A pass would render a stretched
file to disk, which is exactly what a deck must not do: you cannot re-render four minutes of
audio between two nudges of a pitch fader. Tracktion stretches a clip live, through warp
markers, and that is the right mechanism — what the module contributes is the DECLARATION that
this deck has a tempo, which is what lets a desk control name it (`docs/viewBindings.md`).

So a binding to an `offline` module resolves by the TRACK its chain draws from rather than by
a plugin id. The material is what changes, and the track is where the material is.

## The two passes

**The measuring pass** is `@studio/audio-passes`' `peakPass.ts`, run inside `processWithChain`'s
per-source loop and filled from `@studio/audio-analysis`'s true-peak measurement. See that package's `docs/peakPass.md`,
including why the `{file}.cache` envelope is the wrong place to read a peak from.

The `Peak` default attenuates rather than boosts, and should: a chain reaching the engine without
the pass having run is a state the module has to survive.

**The producing pass** is `mediatekChain` diverting an offline step instead of resolving it to a
plugin, `coldPass.ts` saying which model and whether this machine has it, and `processWithChain`
running the pass **in place of** the bounce — no render, nothing repointed, the files beside the
source. So `clip process <clip> <chaîne>` over a chain holding `stemsplit` is how a separation is
asked for.

Two rules come with it, and both are about what a chain can SAY rather than what the pass can do:
a chain separates or treats and never both (flattened for a render it is a list of names with no
ports, so a step after a separator has four inputs and no way to name one), and the running is
handed in through `CommandHost.runColdStep` — a host without one refuses by name. See
`@studio/commands`' `docs/processChain.md` and `@studio/file-service`'s `docs/stemSplit.md`.

## What is NOT wired yet

`io: file` playback (this package's `docs/fileInput.md`) is the one gap left: nothing compiles a
FILE module into a `ProjectDoc` from a song's own YAML.
