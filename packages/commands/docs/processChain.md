# `track process` / `clip process` — bouncing material through a chain

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

One command taking either was written first and thrown away before it landed: resolving
track-then-clip-then-path meant `gtr` and `riff` both worked, so the first word promised nothing
and the log line was the only place you could find out what had actually been bounced. Each
command refuses the other's argument and names the one to run instead. Two also keeps them in
the `<noun> <verb>` namespace every other command uses.

## They replaced `track normalize` and `clip normalize`

Both are **gone**, and so is everything under them: `normalize.ts`, the engine's `--normalize`
mode and `NormalizeClips.cpp`. Normalising is a TREATMENT, and these two commands are how a
treatment is applied — the médiathèque ships a `normalize` module, so a chain naming it does the
same job over a track's files or over one clip's, and can be *followed by something*.

Two things improve on the way, and one is given up.

The old commands wrote their result **over the take**; a bounce lands a stamped render beside the
source and repoints the clip at it, so the material it replaced is still on disk rather than
recoverable only from the journal. And `clip normalize` was one hard-coded gain where
`clip process` is any chain, so a normalisation followed by a limiter is one command instead of a
feature request.

What is given up is **one shared gain across a SET of files**. That is what `--normalize` could
say and a chain cannot: a track's clips normalised together, the loudest reaching the target and
the rest keeping their relative levels. Each source is rendered on its own here (see *Offline,
always* below), so `track process gtr normalize` brings every clip to the target independently.
For a track of takes that were balanced against each other, that is a different result — worth
knowing before reaching for it, and the reason this paragraph is not a footnote.

## What "in place" means

A placement holds a POSITION and names a clip; the clip names a file. So a bounce in place
rewrites exactly one line — `source:` in `clips/<id>.yaml` — and:

- every placement of that clip, on every track, plays the treated material;
- its position, window, fades and loops are untouched, because none of them are in that line;
- the original file stays on disk, so the whole edit is one line to undo.

The clip's `from`/`to` window survives because the render is the **whole file**: same start,
same sample rate, so the seconds it cuts at still mean the same thing. A chain with a tail
(a reverb, a delay) makes the render longer than the source, which the window cannot notice —
it is anchored at the beginning.

Two placements of one clip are one file, so `track process` deduplicates its sources before
rendering. Bouncing twice would have run the second pass over the first one's output.

That is also why `clip process` says *the clip's* file rather than *this placement's*: a clip
is material, and a placement is a reference to it. Treating one placement alone would mean
splitting the clip in two, which is an edit to make on purpose and not a side effect of a bounce.

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

**The médiathèque's**, under its own token: `@st0/live/vocal-strip`, or `@st0/vocal-strip`
by bare name. The project is asked first and the library only under the token, so a project
chain can never be shadowed by a library one that happens to share its name.

A library chain is a TEMPLATE — a `graph.yaml` with `@in` and `@out` for ends, and a `nodes/`
folder beside it — read from the workspace's **library repository** (`_libraries/chains/…`, what
`librariesDirFor` resolves), because that is the disk the engine can open. Same layout as a
project, deliberately and to the filename: see `@studio/mediatek`'s `docs/chains.md`. Each node is
resolved through the project's module vocabulary, so `extends: "@st0/audio/eq"` arrives with the
eq's plugin, params and preset folded in.

That vocabulary is a cache, and it can be short: the unattended pull fetches the modules the
open songs NAME (`@studio/file-service`'s `mediatekPull.ts`), and a library chain names its own.
A step whose module has never been synced is refused **before the first render**, by name —
a chain half-applied writes a file that sounds like the chain minus one treatment, and nothing
about that file says so afterwards.

## Offline, always

`--render`, never the transport: it opens no audio device, so a bounce runs while the live
engine is playing (see `@studio/file-service`'s `docs/render.md`). Each source is rendered
through a separate short-lived engine, from a one-track document holding the file at position 0
with its natural length and the chain as the plugins on it — the same shape the médiathèque
auditions a variant through (`apps/st0/docs/chainPreview.md`).

Nothing else of the song travels with it. **Automation in particular does not**: a curve is
written against song time and this clip starts at zero, so baking one in would apply it at the
wrong moment on every placement.

The engine writes wav and only wav, so the render is a `.wav` whatever the source was. Naming
it anything else would produce a file that lies about itself.

It is a **mixdown**, so it comes back as the master does: stereo, at the project's sample rate,
in the engine's own bit depth. A mono clip therefore comes back stereo.

**It comes back at the level it left**, which this page claimed before it was true: a −12 dBFS file
through a chain set to exactly 0 dB of gain now renders at −12 dBFS, mono and stereo alike.

It used to come back 3 dB down, and the worked example above always said so — a 0.5 sine through a
−6 dB strip rendering at 0.177 is −9 dB, not −6. Tracktion's master fader defaults to −3 dB and
nothing ever moved it, so every mixdown this engine wrote was 3 dB below its material. `EditBuilder`
sets it to unity now. The bug was old and quiet; what made it visible is that a normalisation asks
for an exact level, so a constant offset stops hiding.

## What a cold module still does not get

A **cold** module — one that has to know the whole of its input before it can produce any of it,
like the normaliser in `packages/dsp/modules/normalize/` — is legal here: the input is a file,
which is the condition `coldPlacementError` enforces.

The pass that measures that file and feeds the value back **now runs**, exactly where this page
predicted it would belong: offline, on a file, immediately before the render. It is `peakPass.ts`,
inside the per-source loop, and it reads the number from the engine's `--peak` mode rather than from
the waveform sidecar — see `docs/peakPass.md` for why that distinction is not a detail.

`Peak: 0` remains the default, still attenuating rather than boosting, for a chain that reaches the
engine some other way.

## Re-running

Every run is its OWN file: the render carries a wall-clock stamp,
`riff_warm_260816T101500.wav`, the same spelling every dated file in a project uses (`fileStamp`,
shared with a take's name). Nothing is overwritten, so a treatment you regret is one repoint away
from being undone and the file it replaced is still on disk.

It used to overwrite, and the stamp is what changed: `riff.wav` through `warm` twice landed on one
name, on the argument that a second run is a correction rather than a second thing. That is true of
the INTENT and false of the file — the first render is material somebody may already have listened
to, and a bounce that eats it leaves nothing to compare against.

What has not changed is that the name must not GROW. A previous run of the same chain is stripped,
stamp and all, so ten passes of `warm` leave `riff_warm_<latest>.wav` and not a name carrying ten
dates. A DIFFERENT chain still stacks, deliberately: the clip now plays the warmed file, and
treating that is a second treatment — `riff_warm_<t1>_bright_<t2>.wav` says exactly what it is.

One source's failure is its own: a file the engine could not decode costs that file its bounce,
and the loop continues. Everything that did land is listed, with which clips now play it.
