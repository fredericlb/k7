# Cold modules

A **cold** module only works on audio that is already on disk. It says so itself:

```yaml
# modules/audio/normalize/module.yaml
cold: true
plugin: { type: jsdsp, name: Normalize }
```

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
chain calls it — `module insert`, `chain add`, and whatever the chain views wire to them —
because a rule enforced in two places is a rule that will be enforced differently in one of them.

Three things about how it is asked are deliberate:

- **Before anything is written.** `module insert` creates the module and then splices it in; the
  refusal has to come first, or a rejected drop leaves a folder behind. So the check takes the
  module (or the ref it is about to extend) rather than looking it up by the name it will have.
- **Placing wired to NOTHING is allowed.** `module place` drops a node in connected to nothing.
  There is no input yet to be wrong about, and refusing there would mean refusing to write a
  module you are about to give a file to. The refusal comes when it is wired.
- **The message says what to do**, not only that it refused — a live input has no "whole" yet,
  so the fix is a file source or a médiathèque chain over a song.

## `cold` is inherited

It is a fact about what the module IS, so it is **not** in `moduleResolve`'s `OWN_ONLY`: a use of
a cold module is cold, and an instance that states only its `Target` does not have to restate it.
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

A ready module folder is `packages/dsp/modules/normalize/` — `module.yaml` plus the `jsdsp.ts`
that mirrors the library graph, the same arrangement the crossfade demo uses. Copy it into a
médiathèque `modules/audio/`.

## Cold modules come in two shapes

The normaliser **measures**: the pass reads the file and writes a number back into a param
(`Peak`), and the module's own graph then applies it. That is one shape, and it was the only
one this page described.

A stem separator is the other. It does not produce a number for a graph to use — it produces
**four audio files**, and it has to, because a chain step compiles to a serial insert on one
Tracktion track and there is no fan-out in `ProjectDoc` at all. So it says
`plugin: { type: offline }`: no engine plugin, and a pass writes its outputs before the render.
See `@studio/file-service`'s `docs/stemSplit.md`.

Both are cold for the same reason and obey the same rule — the input has to be knowable in
full — which is why one word still covers them. What differs is what the pass hands back.

### The tempo module is the second producing one

`packages/dsp/modules/tempo/` changes a song's BPM, and it is `offline` for a reason worth
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

It is what m9 puts on each deck — a deck's source being a file is precisely what makes the
placement legal. See `packages/song/docs/m9Project.md`. **The pass is not written**, like
the normaliser's; m9's tempo fader realises the stretch as a clip warp meanwhile, which is a
stand-in and is documented as one in `apps/m9/docs/bpm.md`.

## What is NOT wired yet

**The measuring pass.** Nothing reads a file's peak and writes it into `Peak`: the flag, the
rule, the refusal, the graph and the module are here; the analysis that would make a normaliser
actually normalise is not. `io: file` playback is the other half of the same gap (this package's
`docs/fileInput.md` records it).

Until then a cold module of that shape compiles and applies its default gain. That is why the
`Peak` default attenuates rather than boosts: the un-measured state has to be harmless.

**The producing pass** is further along: `@studio/commands`' `coldPass.ts` decides which steps
are offline and refuses early, and `@studio/file-service` runs the model. What is left is the
call site — `mediatekChain` is where an offline module must be diverted rather than pushed onto
the plugin list.
