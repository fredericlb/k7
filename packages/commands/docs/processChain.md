# `track process` / `clip process` — bouncing material through a chain

```
track process <track> <chain>
clip  process <clip|path> <chain>
```

Runs material through a chain and **keeps the result**: the render lands beside the source as
`<name>_<chain>.wav`, and the clip files are pointed at it. Every placement then plays the
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

It replaces `clip normalize`, which peak-normalised a track's clips to −1 dBFS through the
engine's `--normalize`. Normalising is one treatment, hard-coded, and the médiathèque already
ships a `normalize` module — a chain naming that module does the same job and can be *followed
by something*. The old command wrote `_norm` copies and repointed nothing, so the project had
to be edited by hand afterwards; that half is the interesting one, and it is here now.

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
plays that instead, and deletes the render when you unfreeze (`module freeze`, and
`packages/song/docs/freeze.md`). This rewrites what the clips play, which is what you want when the
treatment IS the sound and you no longer want to carry the plugins that made it.

The two overlap in one place, and `track process` says so: applying a lane's **own** chain to
its clips leaves that chain still running on playback, so the treatment is heard twice. That is
not refused — it is a legitimate thing to want, once you bypass the modules — but nobody should
discover it by ear.

## Where a chain comes from

**The project's own**, by name (`gtr`, whatever `project inspect graph` lists). Its plugins are
taken off the *compiled* document, where the compiler has already resolved every step: its
plugin format, its params, the preset it loads, a jsdsp module's graph. Rebuilding that here
from `chains.yaml` would be a second compiler, and the two would drift.

Two things are dropped on the way out, and both would otherwise be applied twice: a **mixer**
module (a track's level is not a treatment — it stays live on the strip, exactly as a freeze
leaves it) and a `sidechainFrom` (the feeding lane does not exist in a document holding one
track).

A chain that feeds no track and is nobody's bus compiles to no plugins at all — see
`ownerOf` in `@studio/song`'s `nodeProject.ts` — so it cannot be named here. That is the
compiler's rule, not this command's.

**The médiathèque's**, under its own token: `@mediatek/live/vocal-strip`, or `@mediatek/vocal-strip`
by bare name. The project is asked first and the library only under the token, so a project
chain can never be shadowed by a library one that happens to share its name.

A library chain is a TEMPLATE — `chains.yaml` with `@in` and `@out` for ends, and an
`nodes/` folder beside it — read from **this machine's médiathèque cache**
(`~/.studio/mediatek/chains/…`), because that is the disk the engine can open. Each node is
resolved through the project's module vocabulary, so `extends: "@mediatek/audio/eq"` arrives
with the eq's plugin, params and preset folded in.

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
in the engine's own bit depth. A mono clip therefore comes back stereo — and at the same level,
not 3 dB down, because the centre pan law it picked up on the way to the master is exactly the
one a stereo file does not pick up on the way back. Measured, not assumed: a mono sine at 0.5
through a −6 dB strip renders at 0.177, which is −6 dB of chain and −3 dB of pan law, and plays
back at the level it left.

## What a cold module still does not get

A **cold** module — one that has to know the whole of its input before it can produce any of it,
like the normaliser in `packages/dsp/modules/normalize/` — is legal here: the input is a file,
which is the condition `coldPlacementError` enforces. But the pass that would *measure* that
file and feed the value back into the module's params is still not wired anywhere
(`@studio/song`'s `docs/coldModules.md` says so, and `docs/fileInput.md` records the other half).

So a cold module in a chain bounced here applies its default gain, which is deliberately the
harmless direction: `Peak: 0` attenuates rather than boosts. This is where that pass would
belong when it exists — offline, on a file, immediately before the render — and nothing here
pretends it already runs.

## Re-running

The suffix is stripped before it is re-applied, so processing `riff.wav` with `warm` twice
overwrites `riff_warm.wav` rather than producing `riff_warm_warm.wav` — which would be a bounce
OF the bounce, and not what "run it again" means. Running a *different* chain on an
already-processed clip stacks deliberately: the clip now plays `riff_warm.wav`, and treating
that gives `riff_warm_bright.wav`.

One source's failure is its own: a file the engine could not decode costs that file its bounce,
and the loop continues. Everything that did land is listed, with which clips now play it.
