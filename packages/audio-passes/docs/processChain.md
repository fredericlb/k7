# `track process` / `clip process` / `event process` — bouncing material through a chain

```
track process <track> <chain>
clip  process <clip|path> <chain>
```

Runs material through a chain and **keeps the result**: the render lands beside the source as
`<name>_<chain>_<stamp>.wav`, and the clip files are pointed at it. Every placement then plays the
treated material, exactly where it already sat.

## Why two commands

They share every line of their implementation but one — what the first argument may name — and
that one is worth a command each, because the noun IS the promise. `track process` treats every
file the track's clips play; `clip process` treats one clip's file, and therefore every
placement of that clip on every track.

One command taking either would have to resolve track-then-clip-then-path, so `gtr` and `riff`
would both work, the first word would promise nothing, and the log line would be the only place
you could find out what had actually been bounced. Each command refuses the other's argument and
names the one to run instead. Two also keeps them in the `<noun> <verb>` namespace every other
command uses.

## Normalising is a chain, not a verb

There is no `track normalize` / `clip normalize`. Normalising is a TREATMENT, and these two
commands are how a treatment is applied — the médiathèque ships a `normalize` module, so a chain
naming it does the same job over a track's files or over one clip's, and can be *followed by
something*.

A bounce lands a stamped render beside the source and repoints the clip at it, so the material it
replaced is still on disk rather than recoverable only from the journal. And `clip process` takes
any chain rather than one hard-coded gain, so a normalisation followed by a limiter is one command
instead of a feature request.

What a chain cannot say is **one shared gain across a SET of files**: a track's clips normalised
together, the loudest reaching the target and the rest keeping their relative levels. Each source
is rendered on its own here (see *Offline, always* below), so `track process gtr normalize` brings
every clip to the target independently. For a track of takes balanced against each other, that is
a different result — worth knowing before reaching for it, and the reason this paragraph is not a
footnote.

## What "in place" means

A placement holds a POSITION and names a clip; the clip names a file. So a bounce in place
rewrites exactly one line — `source:` in `clips/<id>.yaml` — and:

- every placement of that clip, on every track, plays the treated material;
- its position, window, fades and loops are untouched, because none of them are in that line;
- the original file stays on disk, so the whole edit is one line to undo.

The clip's `from`/`to` window survives because the render is the **whole file, unwarped, at
position zero** (`bounceDoc`, and a test pins that document's shape): same start, same rate,
sample for sample — measured on a real pair, zero frames of lag. So the seconds the window cuts at
still mean the same moment. It is anchored at the beginning, and the render being longer is
something it cannot notice.

### …but the STRETCH MAP is not anchored at the beginning

It is anchored at both ends. `applyClipWarp` hands Tracktion the map's beat span as the length of
the *whole source*, so the last marker's second is what says how long the take is and therefore at
what tempo it was played.

**Every render is two seconds longer than its source**, tail or no tail: `fullRange` adds them
unconditionally, for synth release and reverb. Left alone, a 17.920 s take at 110 bpm comes back
19.920 s, the engine reads 32.834841 beats over 19.92 s as **98.9 bpm**, plays 11% slow, and — an
unlooped clip being capped at its window in SOURCE seconds — cuts the phrase before its end.

So the repoint retimes the map as it goes: `retimeWarpMarkers` moves its END onto the render's
length, continuing at the map's own rate, and touches nothing else
(`@studio/song`'s `docs/warp.md`). A render that changed no duration leaves the clip file
byte-identical.

The two seconds are kept rather than trimmed, deliberately: a chain *can* legitimately lengthen
material — a reverb tail is part of the treatment, and bouncing it is the point. What has to be
avoided is the map describing a length the file has not got, not the file being longer.

Two placements of one clip are one file, so `track process` deduplicates its sources before
rendering. Bouncing twice would run the second pass over the first one's output.

That is also why `clip process` says *the clip's* file rather than *this placement's*: a clip
is material, and a placement is a reference to it.

`event process <track> <at> <chain>` is the one that treats a placement alone, and it does so by
making that split on purpose: when any other event plays the same material — as its own or as a
take — the event first gets a copy of the clip file (`<ref>-2`, `-3`…), and only that copy follows
the render (`repointClips`' `only`). It is what a right-click on an event offers, since what was
clicked there is the placement, and a menu entry that rewrote every other placement of the file
would be acting on things nobody pointed at. A comped event plays several files and is refused
until it is consolidated. A bounce that writes nothing puts the event back on its material and
deletes the copy, so a failed run leaves no stray clip behind.

## Not a freeze

Freezing is reversible and leaves the material alone: it bounces everything upstream of a module,
plays that instead, and deletes the render when you unfreeze (`node freeze`, and
`packages/song/docs/freeze.md`). This rewrites what the clips play, which is what you want when the
treatment IS the sound and you no longer want to carry the plugins that made it.

The two overlap in one place, and `track process` says so: applying a lane's **own** chain to
its clips leaves that chain still running on playback, so the treatment is heard twice. That is
not refused — it is a legitimate thing to want, once you bypass the modules — but nobody should
discover it by ear.

## Where a chain comes from

**The project's own**, by name (`gtr`, whatever the chains pane draws). Its plugins are
taken off the *compiled* document, where the compiler has already resolved every step: its
plugin format, its params, the preset it loads, a jsdsp module's graph. Rebuilding that here
from `graph.yaml` would be a second compiler, and the two would drift.

Two things are dropped on the way out, and both would otherwise be applied twice: a **mixer**
module (a track's level is not a treatment — it stays live on the strip, exactly as a freeze
leaves it) and a `sidechainFrom` (the feeding lane does not exist in a document holding one
track).

A chain that feeds no track and is nobody's bus compiles to no plugins at all — see
`ownerOf` in `@studio/song`'s `nodeProject.ts` — so it cannot be named here. That is the
compiler's rule, not this command's.

A chain that is ONLY a strip is refused for a related reason: the mixer is the one thing dropped
on the way out, so there would be nothing left to bake in and the "bounce" would write a copy of
the source under a name promising a treatment.

A project chain also carries no cold steps, by construction. It is read off the compiled
document and the compiler emits no plugin for an offline module (`nodeProject` skips the type by
name), so there is nothing here to divert — seeing it would mean reading the graph a second
time. A separation is asked for by naming the library chain that holds it, which is where
`stemsplit` lives anyway.

**A library's**, under its name: `@k7-core/live/vocal-strip`, or `@k7-core/vocal-strip` by bare name —
`@drums/kit/room` for another library. The project is asked first and a library only under its
`@<name>/`, so a project chain can never be shadowed by a library one that happens to share its
name. A name with no `@` that no project chain answers is looked for in every library, the default
`k7` first: that is what a bare chain name meant before libraries had names.

A library chain is a TEMPLATE — one file, `<library>/chains/<path>.yaml`, written as a project's
chain is and ending at `@out` (`@studio/song`'s `docs/sharedFolders.md` has the layout and why) —
read from the account's **libraries**, because that is the disk the engine can open, rather than
the machine's médiathèque cache. `@studio/song`'s `libraryChains.ts` is the one reader, for this
command, the bench and the chains builder alike: it walks every library's `chains/`, reads the
folder layout a clone may still hold as well, and hands back the steps in order. A library with no
`chains/`, or none cloned at all, is an empty list, never a throw. Each step is resolved through
the project's module vocabulary, so `extends: "@k7-core/audio/eq"` arrives with the eq's plugin, params
and preset folded in. A **bypassed** step is in the template and out of the signal, so a bounce
skips it.

That vocabulary can be short: a library chain names modules of its own, and one the workspace
does not hold is simply not there.
A step whose module has never been synced is refused **before the first render**, by name —
a chain half-applied writes a file that sounds like the chain minus one treatment, and nothing
about that file says so afterwards.

## Offline, always

`--render`, never the transport: it opens no audio device, so a bounce runs while the live
engine is playing (see `@studio/file-service`'s `docs/renderers.md`). Each source is rendered
through a separate short-lived engine, from a one-track document holding the file at position 0
with its natural length and the chain as the plugins on it — the same shape the médiathèque
auditions a variant through (`packages/ui-library/docs/playback.md`).

Nothing else of the song travels with it. **Automation in particular does not**: a curve is
written against song time and this clip starts at zero, so baking one in would apply it at the
wrong moment on every placement.

The engine writes wav and only wav, so the render is a `.wav` whatever the source was. Naming
it anything else would produce a file that lies about itself.

It is a **mixdown**, so it comes back as the master does: stereo, at the project's sample rate,
in the engine's own bit depth. A mono clip therefore comes back stereo.

**It comes back at the level it left**: a −12 dBFS file through a chain set to exactly 0 dB of gain
renders at −12 dBFS, mono and stereo alike. That rests on one line — Tracktion's master fader
defaults to −3 dB and `EditBuilder` sets it to unity, without which every mixdown would be 3 dB
below its material (`docs/peakPass.md`).

## What a cold module gets

A **cold** module — one that has to know the whole of its input before it can produce any of it,
like a normaliser on `@studio/dsp`'s `normalize()` graph — is legal here: the input is a file,
which is the condition `coldPlacementError` enforces.

The pass that measures that file and feeds the value back is `peakPass.ts`, inside the per-source
loop: offline, on a file, immediately before the render. It reads the number from a true-peak
measurement rather than from the waveform sidecar — see `docs/peakPass.md` for why that
distinction is not a detail.

`Peak: 0` is the default, attenuating rather than boosting, for a chain that reaches the engine
some other way.

## A chain that SEPARATES rather than treats

`cold` covers two shapes, and only one of them is still a plugin. The normaliser above needs a
**number** before it can run and is otherwise an ordinary insert — one buffer in, the same buffer
out. A stem separator needs the whole file to produce **files**, and fans out one input into four:
there is no serial insert that can be, so it declares `plugin: { type: offline }` and has no engine
plugin at all (`@studio/song`'s [coldModules.md](../../song/docs/coldModules.md)).

`mediatekChain` diverts those steps instead of resolving them to a plugin — the line
`@studio/file-service`'s `docs/stemSplit.md` points at. What follows from it:

- **The chain either separates or treats, never both.** Flattened for a render (`chainSteps`) a
  chain is a list of module names with no ports on it, so a step *after* a separator would have
  four inputs and no way to name one. Refused by name rather than guessed at — the graph itself can
  say it (`stemsplit#vocals: [ reverb ]`, `docs/ports.md`), so this is the sentence to revisit the
  day `chainSteps` carries the port.
- **A cold run writes files and repoints nothing.** There is no single output for a clip to point
  at; the four stems land in `stems/` beside the source, where the médiathèque already looks for
  them (`packages/rehearsal-server/docs/audio.md`). What changes is the workspace, not the project — the run still
  reports `changed`, because the tree has four new files in it.
- **It runs before the engine check**, and needs no `k7-runtime`: a separation is ffmpeg and a
  model, not a bounce.
- **The running is handed in**, `CommandHost.runColdStep` (`coldPass.ts`'s `RunColdStep`). The
  166 MB model lives in `@studio/file-service`, which depends on this package, so importing it
  back would be a cycle. A host without one refuses the chain by name rather than bouncing the mix
  unseparated under a name promising stems.
- **Which model, and whether this machine has it**, is answered while the chain is resolved
  (`coldStepOf`), so a machine that has not downloaded it costs no time and leaves no file — and
  the two failures are told apart: a module authored with no `onnx:` is a bug, a model missing
  from `<state>/models` is a download.
- **A cold chain this machine cannot run yet is still LISTED** (`coldChains`), with the reason.
  An undownloaded model is a fact about the machine, not about the chain, and it is fixed without
  touching the library; hidden, a library full of separating chains reads as holding none.

**The seed carries both.** `k7-core/` holds `stemsplit` the MODULE (`modules/cold/stemsplit`) and
`chains/stems.k7x` naming it, so a library seeded from it can separate from its first day; what the
module has to say is in `@studio/dsp`'s `docs/catalogue.md`. The chain is one file, in substance:

```yaml
# <library>/chains/stems.yaml
steps:
  - { id: 69d0d198-…, extends: "@k7-core/cold/stemsplit" }
  - to: [ { chain: "@out" } ]
```

…and then `clip process riff @k7-core/stems`.

**Name it once with `system stems @k7-core/stems`.** Which chain separates is a standing answer — the
same for every playlist, every set and every clip — so it lives in `<state>/preferences.yaml`
beside the rig's other ones, and `playlist stems` and `POST /stems` read it rather than asking. The
verb checks, when it is set, that the chain really separates: the cheap moment to find that out is
before thirty songs, not during them.

**For a SET it is `playlist stems <playlist> [chain]`** — the same work over every song a set list
names, and over the MACHINE's copies (`<state>/mediatek/songs/…`), since that is the disk a deck
opens. Three properties make it a command you run the night before rather than once: a song whose
`stems/` already holds something is skipped, the registry's id hashes the WORK (so even an
interrupted pass costs nothing twice), and an unreadable song costs its own line rather than the
other twenty-nine. Writing beside a song is safe: nothing on the machine prunes a song folder of
files it did not put there.

What a deck then DOES with the four files — subtract one from the mix, and why that rather than
summing the stems — is `packages/song-schema/docs/stems.md`.

The file service's implementation awaits the **job registry** rather than calling the worker: the
id hashes the work, so a retry or a second tab joins the run in flight instead of starting another
hour of arithmetic, and the inference stays on a worker thread while the service goes on answering.
One `/command` request therefore stays open for the length of a separation — minutes — which is
the shape this verb has.

## Re-running

Every run is its OWN file: the render carries a wall-clock stamp,
`riff_warm_260816T101500.wav`, the same spelling every dated file in a project uses (`fileStamp`,
shared with a take's name). Nothing is overwritten, so a treatment you regret is one repoint away
from being undone and the file it replaced is still on disk.

The stamp is what keeps them apart. `riff.wav` through `warm` twice would otherwise land on one
name, on the argument that a second run is a correction rather than a second thing. That is true of
the INTENT and false of the file — the first render is material somebody may already have listened
to, and a bounce that eats it leaves nothing to compare against.

The name must not GROW either. A previous run of the same chain is stripped,
stamp and all, so ten passes of `warm` leave `riff_warm_<latest>.wav` and not a name carrying ten
dates. A DIFFERENT chain still stacks, deliberately: the clip now plays the warmed file, and
treating that is a second treatment — `riff_warm_<t1>_bright_<t2>.wav` says exactly what it is.

One source's failure is its own: a file the engine could not decode costs that file its bounce,
and the loop continues. Everything that did land is listed, with which clips now play it.
