# The import pipeline

Four modules. `model.ts` holds the neutral shape; **one mapper per foreign format** reads
into it (`dawproject.ts`, `ableton.ts`); then `params.ts` enriches and `emit.ts` writes.

```
.dawproject ─┐
             ├─► Translation {song, files, stats, warnings} ─► params.ts ─► emit.ts
.als ────────┘
```

Only the mappers know a format. Everything downstream is format-blind, which is the whole
reason a second format is one file rather than a second pipeline.

## Two ways in, one translation

The mappers are reached from `packages/file-service/src/projectLifecycle.ts`, by two entry points
that differ only in where the bytes come from and who names the folder:

| | reads | folder name | leaves behind |
|---|---|---|---|
| `importProjectInto` | a file already IN the workspace, clicked in st0's tree | the file's stem, uniquified | the source file, where it was |
| `importProjectBytes` | bytes handed over — a file DROPPED on a workspace row on st0's home page | what the popin asked for, refused if taken | nothing but the project |

The second exists because a drop has no file in the workspace to point at, and because the person
doing it is looking at a list of projects: the folder is what they will look for afterwards, so it
is asked for rather than derived. A name somebody typed is never quietly renamed — an occupied one
is refused, the way `project new` refuses it. A name nobody typed still gets today's `-2` suffix,
since there was no answer to change.

**A drop takes the self-contained formats** (`DROPPABLE_PROJECTS`, in `@studio/web-protocol` so the
browser and the service filter on one list): a `.dawproject`, whose audio is inside the archive, and
a `.zip`, which here MEANS an Ableton project — the folder Live's *Collect All and Save* leaves,
zipped with its samples. A lone `.als` is not one: it names its samples by path and
`makeSampleReader` resolves them against its own location in the workspace, so a dropped one alone
would import a project with no sound in it and nothing to say which files were meant. That one is
imported from the tree, where it sits with its folder, and the refusal says so.

### A zipped Ableton project

`abletonZip.ts` unzips in memory and hands `parseAls` a sample reader over the archive. Two choices
in it:

- **The set is the one `.als` outside `Backup/`.** Live writes a dated copy there on every save, each
  a valid `.als` of an OLDER state; taking one would import last week's arrangement without a word.
  A Mac's `__MACOSX/` and `._` files are skipped the same way. Two sets side by side is refused by
  name rather than guessed between.
- **A sample is found where the set says, else by its file NAME** when exactly one file in the zip
  bears it. The relative path is right for a collected project; the name catches a folder zipped
  from a level above or below it, where every relative path is off by the same prefix. An absolute
  path is never followed: it names a disk on another machine.

### What an Ableton set holds that is not the song

- **Take lanes are left out.** Live 12 keeps every take beside the arrangement, under `TakeLanes`;
  the comp it plays is ordinary clips on the main lane. A take nobody picked is not the song, and
  its file need not be in the project at all — *Collect All and Save* collects what the arrangement
  plays, so a real export named 78 take-lane clips whose recordings were never in the zip. They are
  counted in the log, like Session view clips.
- **A clip whose sample cannot be read is left out**, and the log names the file. Placed on a file
  that is not there, one clip would make the loader refuse the whole song; left out, the song
  opens and the hole is said once, where the fix (collect it, re-import) can be read.

### A warped clip's in-point is a beat of the CLIP's grid, not of the file

Live measures a warped clip's `LoopStart` on the clip's own warp grid, and that grid's beat 0 is not
the file's second 0: the first `WarpMarker` says which beat second 0 sits on, and a recording Live
lined up late puts it at beat 4 or 0.6 rather than 0. st0's window counts beats into the FILE — its
`from` is source seconds at the project tempo. So `mapAudioClip` reads the in-point THROUGH the
markers (`sourceSecondAt`, extending the end segments' rate past them) instead of copying it. Copied
straight, every such clip played the file that many beats late — 3.7 s on one real export's solo —
while every clip whose first marker happened to sit on beat 0 lined up, which is what hid it.

## A MIDI lane always has an instrument

An instrument that does not cross over — Live's own synths and drum racks have no portable form —
would leave a lane's notes wired straight into its strip, which the loader refuses: one such track
made a whole imported song refuse to open. So `emit.ts` puts a library instrument in its place, a
node at the head of the lane's run saying it is a STAND-IN, and the import log counts them. A drum
rack (`TrackOut.drums`, set by the mapper when a `DrumGroupDevice` sits anywhere in the track's
chain) gets the SFZ kit, whose pads are on General MIDI notes as most drum racks' are; anything else
gets Surge XT. A stand-in is a sound to hear the part with, not a translation of the original.

## One file per RECORDING, not per clip

A foreign project cuts several clips out of one take, and some exports write one file per clip
regardless — byte for byte identical, under a dozen names. Written straight through, that is what
lands on disk: one real import came out at 345 MB for 91 MB of audio, nineteen files where four
would do, and the waveform pass then decodes every copy.

So `emit.ts` keys the audio it writes by CONTENT (`audioFor`), because that is the half both cases
share, and names each file after the source the archive called it rather than after any clip. Each
clip keeps its own `clips/<id>.yaml` — the window, the fades and the warp markers are the clip's,
and only the bytes are shared. Measured on a real Bitwig export: 54 clips, 51 recordings, 243 MB
written instead of 258.

## `model.ts` — the neutral shape

`Song`/`TrackOut`/`ClipOut`/`PluginOut`/`WarpOut`, plus the `Translation` a mapper returns.
It lives apart from any mapper on purpose: a second importer reaching into a first one's
file for the shared model is a lie about where the boundary is.

Every mapper obeys the same contract: **no disk I/O**. It returns the song plus asset
bytes, and the caller writes them. A `.dawproject` carries its audio inside the archive; a
`.als` does not, so `parseAls` takes a `readSample` callback instead of opening files
itself — the contract holds either way.

## `dawproject.ts` — the mapper

A `.dawproject` is a ZIP of `project.xml` (the song), `metadata.xml`, plus `audio/*` and
`plugins/*` assets. This module unzips the bytes in memory, parses `project.xml`, and
projects it onto st0's song schema — the same shape `project.ts` reads back. It
performs NO disk I/O: it returns the song object plus every asset entry for the caller
to write out.

The mapping is deliberately lossy where st0 can't yet represent something (warps /
time-stretch, plugin state, automation): those are dropped, while the structural
essentials (tracks, params, audio clips, MIDI notes, plugin refs, sends) are carried so
a later phase can wire them.

### A container plays a WINDOW of its children

A `<Clip>` holding `<Clips>` is a container: its children live in the container's own timeline, and
the container's `time`/`duration`/`playStart` select the slice of them it plays. `collectClips`
positions each child absolutely and clamps it to that slice.

**A child clamped to nothing is dropped, not emitted at zero length.** The same material appears
under several containers — that is what containers are for — and each one plays a different part of
it, so every other container clamps it away. Emitted anyway, those became zero-length clips piled
on the lane at the same beats, which reads as overlapping takes the source project never had: on
one real export, 48 of 124 clips were that, and the arrangement looked doubled. There is nothing to
warn about — a container not playing a child is the ordinary case, not a fault.

**A child cut at its head plays from where the cut lands IN it.** The beats the window clips off
the front are material this placement skips, so they are added to the child's own `playStart`.
Bitwig writes every audio clip this way — a container whose `playStart` selects a slice of one take
placed at 0 — and an in-point read from the child alone plays every such clip from the top of the
take, shifted by exactly the container's `playStart`. Children of a nested container are placed
against its unclamped start for the same reason.

**An unwarped audio leaf counts its in-point in seconds.** With no `<Warps>`, Bitwig writes the
leaf as `contentTimeUnit="seconds"`: `time` and `duration` stay in beats, `playStart`/`playStop` are
seconds into the file. The in-point is converted at the project tempo; read as beats, a take cut
into segments plays each one from the wrong place in it, the further into the take the further off.

**`enable="false"` is carried as the placement's `disabled`**, on the clip and on everything under a
disabled container: the clip stays visible on the lane and silent, as it was in the source.

### Content written once and placed several times

A `<Clip>` may carry no content at all and name a `reference` instead: DAWproject writes one
pattern once, under an `id`, and every placement points at it. A drum groove dropped at eight bars
is eight empty clips and one `<Notes id="…">`. Bitwig does it for anything out of its library, and
for repeated audio.

`indexById` walks the parsed document once — a reference may point forwards, and every track may
use the same id — and `withReferenced` reads the target in as if it had been written inside the
clip. Only `Notes`, `Audio` and `Clips` are read that way: an id resolving to something else (a
`Channel`, say) is not content, and the warning says which of the two happened rather than claiming
the file does not define it.

**What is shared is the CONTENT, never the placement.** `time`, `duration` and the loop points
belong to the clip that named the reference, and the notes are copied into each placement — two
placements of one groove are two clips, and editing one must not reach the other.

Measured on a real Bitwig export (`LEMO - DANSE`): 42 → **49** audio clips, 28 → **35** MIDI clips,
913 → **1069** notes, and the warnings drop from 10 to 1 — the one that is left is a clip which
genuinely holds nothing and points nowhere.

## `ableton.ts` — the .als mapper

A `.als` is **gzipped XML**, one `<Ableton><LiveSet>` document, no container and no
embedded assets. Unlike DAWproject it has no spec: the schema is Live's own, undocumented,
and it drifts between versions. What follows is what a real Live 12.4 set contains — each
line is here because getting it wrong fails *silently*.

### The readings that bite

| | Live writes | what it means |
|---|---|---|
| master track | `<MainTrack>` in 12, `<MasterTrack>` in 11 | both are accepted; the rename is the single biggest 11→12 break |
| time signature | one packed integer on the main mixer — `201` | `num = v%99+1`, `den = 2**(v/99)`, so 201 is 4/4. `RemoteableTimeSignature` exists but only *inside a clip* |
| mute | `<Speaker>` where `true` = **audible** | `mute` is its inverse |
| pan | −1..1 | the model wants 0..1 |
| MIDI pitch | on the enclosing `<KeyTrack>`, not the event | the event carries only time/duration/velocity |
| clip position | audio under `MainSequencer/**Sample**/…`, MIDI under `MainSequencer/**ClipTimeable**/…` | no fixed path works; the mapper walks the track instead |

### Two that are worth their own paragraph

**An unwarped clip's region is in SECONDS.** Live puts the region in the same `<Loop>`
fields whether the clip is warped or not, and only `IsWarped` says which timeline it is in:
beats when warped, seconds when not. At 110 bpm that is a factor of 110/60 — every unwarped
clip lands 1.83× off, in a way that looks like a plausible arrangement rather than a bug.
Measured across a real set, the ratio is exact.

**`<Loop>` holds two different things depending on the brace.** With the loop ON, playback
starts at `StartRelative` and `LoopStart`/`LoopEnd` is a brace around the whole clip (often
0..244 for a clip that plays eight beats). With it OFF, `LoopStart`/`LoopEnd` *is* the
region and `StartRelative` is 0. Reading only one of them misplaces about half the clips in
a real arrangement. The loop brace is deliberately not passed on to `materialWindow`: a
full-clip brace would slice the window from 0 and drop every note.

Warp markers, by contrast, are a gift — `<WarpMarker BeatTime SecTime>` is already the
model's `[timeline beat, source second]` pair.

### What it carries, and what it cannot

Carried: tempo, signature, sample rate (off the first `SampleRef`), tracks with
volume/pan/mute, arrangement clips with warps, MIDI notes at full fidelity, and VST2/VST3/AU
plugins with their state blob — including plugins nested inside a **rack**, since an
Instrument Rack wrapping a VST is ordinary.

Not carried, each reported by name in the import log rather than dropped quietly: Live's own
devices (`Eq8`, `Operator`, `Roar`… have no portable form), the rack structure itself, sends
and return tracks, group tracks, Session view clips, and track colours (Live stores a palette
index, and the palette changed between 11 and 12).

Two traps worth naming. `<FileRef>` appears under samples, under device presets (`.adv`,
`.adg`) **and under VST binaries** — a real set held three strangers' home directories and a
`Program Files` DLL path — so only `SampleRef/FileRef` is treated as audio. And Live's
`<Buffer>` hex is wrapped across indented lines, so everything non-hex is stripped before
decoding.

### Samples live outside the file

A `.als` references audio by path, and `RelativePath` is **empty** unless the set went
through Live's *Collect All and Save*; what is always there is an absolute path from
whatever machine wrote it. Following those would let a crafted `.als` read any file on the
engine's machine, so the file service resolves **only** the relative path, and only through
`safePath` (see `packages/file-service/src/projectLifecycle.ts`).

The consequence is deliberate and must stay visible: an uncollected set imports its whole
structure and **no audio**. The import log says so in its own line, naming the fix, because
an import that lands silent is otherwise unexplainable.

## `params.ts` — plugin state → text params

A `.vstpreset` is an opaque blob; text params are diffable and live in the chain. This
module asks the engine to enumerate a plugin's parameters as `paramID -> value`, so
`emit.ts` can write chain params instead of a preset:

- **built-ins**: `st0-engine --dump-params <type>`
- **externals**: `st0-engine --dump-params-ext <format> <id> <statefile>`
  (instantiate the plugin, restore its `.vstpreset`, dump params)

The engine reports whether the params fully reproduce the state ("complete"); only then
is the opaque preset dropped. An external plugin is located in the st0 cache
(`<state>/exts.json`) by name to get its format + identifier, and its state bytes
(from the archive) are written to a temp file for the engine.

The whole step is a no-op when the engine binary isn't found, so import still works
without a built engine — presets are kept then.

**Live's blobs do not survive this step**, and that is expected rather than a bug to chase:
what a `.als` stores is the plugin's *raw* state (Arturia's is `boost::serialization`), not
a `.vstpreset` container, so the engine loads nothing and reports no params. Measured
against a real set, all three plugins come back empty and keep their preset — which is the
normal degraded path, not a failure. `ableton.ts` does seed the named parameters Live
exposes to automation, but they are only ever a subset (384 of a plugin's 2276), so
`paramsComplete` is never set and `emit.ts` correctly prefers the preset over partials.
Those params matter only for a plugin whose blob would not decode at all.

## A sole insert is folded, unless the name is a chain's

One use of a plugin needs no node file: the module IS the node, and the chain names it bare. The
exception is the collision `graph.yaml`'s one name space makes: a lane wins a bare name there
(`packages/song/docs/trackModules.md`), so a step folded onto a name a chain already has reads as
the chain naming ITSELF. The step then disappears from the segment, and on an instrument track the
lane's midi lands on the next module's audio input — "port 'in' expects audio but source is midi",
about a chain whose instrument is nowhere to be seen.

It is the default a DAW writes: a track called after the device on it. So the fold is skipped when
`chains[mod.name]` exists, and the insert keeps its `<module>_<track>` node.

## Every lane ends on a fader

An st0 lane has a strip of its own, last in its run — a node on the library's mixer, and the
gutter fader, the card and the Mixer view are three drawings of it
(`packages/song/docs/trackMixer.md`). A lane without one plays at unity with nowhere to put a
level.

So each emitted lane gets `nodes/mix-<lane>.yaml`, a last step naming it, and nothing else: the node
extends **`@meta/audio/mixer`** — `SHARED_STRIP`, st0's own module that every mixer node in every
project is a use of (`packages/song/docs/metaModules.md`).

**No project module is written for it**, and that is the point rather than a saving. A project-owned
copy of a library module compiles to the same audio and draws **a card with no controls on it**: a
card draws the `ui.yaml` beside the module it resolves to, and the library's `mixer/` is what
carries one (`packages/song/docs/liveProject.md`). Writing the plugin inline here would also mean
the import deciding what a strip IS, in a project whose library already says.

A return bus and the master chain get none: neither is a lane, and a strip on them would be a
second level in the path with nothing drawing it.

The strip runs into **`MIX`**, and `MIX` into the master run — or straight to `OUT` when the source
project's master track carries no plugins. That is the notation every st0 project uses
(`packages/song/docs/masterChain.md`): not an audible difference, since every track feeds the
master bus whatever it names, but the shape the rest of the app reads. A lane that ended at `OUT`
is one `planTrackMixer` refuses to touch — "does not run into MIX, wire its strip by hand" — so an
imported project could not be repaired by the tool that repairs every other one.

## The surface, so the song can be looked at

A project draws what it DECLARES (`packages/song/docs/surfaces.md`): no `surfaces/timeline.yaml`,
no lanes on screen, no transport and no minimap — the song still compiles and still plays, which is
what makes the absence read as a broken editor rather than as a missing file.

Every import writes one. What a `.dawproject` or a `.als` carries IS an arrangement — tracks and
clips against a ruler — so the project that comes out of one says so. It is the only surface an
import declares: there is no picture in either format, and a desk is something you build rather
than something a foreign project describes.

## `emit.ts` — the output layout

```
<outDir>/
  project.yaml                  header
  graph.yaml                   the graph: track -> modules -> strip -> MIX -> OUT
  modules/io/OUT/module.yaml    the stereo-output sink (io module)
  modules/{instruments,audio,transformers}/<slug>/module.yaml
                                self-contained modules, each its own folder filed by
                                type (the folder gives the kind + input port): the
                                plugin inline + its params; deduped by plugin+params
  nodes/<slug>.yaml             a LANE: `extends` a track module, plus its placements
  nodes/<module>_<lane>.yaml    one USE of a plugin used more than once: `extends` the
                                module above and holds only what this use changes
  nodes/<node>.vstpreset        that use's own plugin state, beside its file
  clips/<id>.yaml (+.wav)       raw audio material
  sequences/<id>.yaml           raw MIDI material (inline notes)
```

Nodes are **flat**, and a chain step names one by its filename alone — never
`<module>:<node>`, the layout [nodes.md](../../song/docs/nodes.md) rules out. A plugin used
exactly once keeps its settings in `module.yaml` and gets no node file at all.

No schema file: a project is validated in process against the loader's own schemas
(`packages/song/src/yaml/`), so there is nothing to ship alongside it.

### What the emitter decides, and why

These are the choices `src/emit.ts` makes that a reader would otherwise have to reconstruct.

**Every timing field is a `#Timecode` STRING, never a bare number.** A bare `4` parses as BARS
and lands the clip at beat 12. And a timecode is written QUOTED: bare, `25:1` is a YAML 1.1
sexagesimal. The shape decisions in the emitters match what st0 itself writes — a placement, a
chain node or a note stays on ONE line.

**A placement does not carry the clip's extent.** That belongs to the material, as a `from`/`to`
window in the clip's or sequence's own file (`materialWindow`). All the placement adds is how many
times that window is played. A window starting at the material's own beginning says so by
omission, which is how a hand would write it.

**A lane file has no `name:` field.** The FILE names the lane and the track's name drives the
slug, so the display name is that slug. A lane is a NODE of `@meta/track` and is not typed, so
an imported track's clips carry their own kind, and one track holding both audio and MIDI is the
ordinary case rather than a shape with nowhere to go. Its mute is its module's bypass and goes to
`graph.yaml`. The lane file's own key is `events:`, not `clips:`:
a clip is the material in `clips/<id>.yaml`, and these are placements of it. See
[trackModules.md](../../song/docs/trackModules.md).

**One module per PLUGIN, one insert per use.** Modules are keyed by the plugin rather than by its
settings, so a plugin used several times becomes nodes rather than a `reverb_2, reverb_3` pile.
Each insert gets its OWN node even when identically set: they are separate slots, and sharing one
would make tweaking the vocal's reverb silently retune the drums'. A plugin used in exactly ONE
place then folds back into `module.yaml`, so an import pays for nodes only where settings really
differ.

Because a node is flat (`nodes/<name>.yaml`, named by its file alone), a node shares ONE namespace
with the lanes and the modules a chain step may equally name, and uniqueness has to hold across all
three. A module whose sole use folded back has its own name taken as far as a node is concerned.

**A plugin's type folder comes from its role, and `transformers` is written rather than the legacy
alias `midi`.** An import creates fresh folders, so writing the alias would give every imported
song a legacy layout on day one.

**Text params capture state when they are complete or when there is no preset**; otherwise the
opaque `.vstpreset` is kept and the partial params are skipped. The preset is written beside the
file whose state it is: `nodes/<node>.vstpreset` for a node, and the module's own folder for the
sole use that stayed in `module.yaml`.

**A plugin the cache does not know gets NO module of its own.** Every use of it is written as a
node on `@meta/not-supported`, the built-in placeholder, carrying the plugin's real name as
`plugin.name` and the params the export held. The chain routes through it and the graph draws it amber.
`packages/song/docs/notSupported.md` argues the shape — chiefly why a stub MODULE per unloadable
plugin was the wrong answer, and why the ref is `@meta` rather than `@st0`.

The scan it checks against is read through `scannedPlugins()` and never by opening a path of its
own. That is the whole of the rule, and the failure it prevents is silent: a hand-rolled read
naming the wrong home finds no file, `verify` is false, and every plugin is taken as loadable —
the import looks like it worked and the check simply did not run. `scannedPlugins()` is the file
the engine itself writes and it honours `$STUDIO_HOME`, as every reader of the state dir
must. With no scan cache at all there is genuinely
nothing to check against, and the verification is skipped.

**Audio and no MIDI means a bounced track**, so its instrument and note FX are dropped (the frozen
remains) and the audio FX kept.

**Dead return buses are dropped, and the drop cascades**, since one may feed another bus that is
now itself unfed. An orphaned insert must not count towards "used more than once", so only the
module refs a SURVIVING chain names are counted before the sole-insert fold.

### The graph is SEGMENTS, and sends lose their level

`graph.yaml` holds who feeds whom, and that is where the imported sends survive: a node lists as
many destinations as it has, so a track that is dry to master AND feeding a bus keeps both — a
format giving a chain ONE sink would have to drop one of them. A `to` naming another chain resolves
to the module that chain starts at, since a chain is not something to route to by name.

The send LEVELS are lost. A destination list says WHERE the signal goes, not how much of it,
so a weighted send arrives at full strength — the emitter counts them and writes a `NOTE:` comment
at the top of the file saying so, with the remedy (trim them on the bus's own module).

There is ONE map in that file, lanes first, because a lane is a module too and putting the runs'
sources at the top is what makes the file read the way the signal flows. A lane the import found
MUTED is listed under `bypassed:`, which is where a lane's mute lives.

### Reading a Live set: the traps

The `.als` schema is undocumented and version-drifting, and every one of these fails **silently**
when read wrong. `src/ableton.test.ts` pins each against a real Live 12.4 set, in hand-written XML
rather than a fixture — a `.als` is a binary carrying personal paths.

**`<Loop>` holds two different things depending on the brace.** With the loop ON, playback begins
at `StartRelative` and `LoopStart`/`LoopEnd` is the brace around the whole clip; with it OFF,
`LoopStart`/`LoopEnd` IS the region and `StartRelative` is 0. Reading only one of them misplaces
half the clips in a real set.

**An unwarped clip's region is in SECONDS, a warped one's in beats**, and Live writes both into
the same `<Loop>` fields. The only thing telling them apart is `IsWarped` — miss it and every
unwarped clip lands off by tempo/60, which is 1.83× at 110 bpm. Verified across a real set: the
ratio is exact.

**A MIDI clip's loop brace is deliberately not carried.** Live leaves a full-clip brace (0..244) on
clips that play eight beats of it, and passing that region to `materialWindow` would slice the
window from the brace instead of the clip's own start, dropping every note.

**The pitch lives on the `KeyTrack`, not on the event** — the one structural surprise of Live's
MIDI.

**`Speaker` is the track's ON state**, so mute is its inverse; and Live pans −1..1 where the model
wants 0..1.

**The time signature is packed into one integer**: 201 → 4/4, the denominators being the powers of
two with 99 numerators each. `RemoteableTimeSignature` exists too, but only inside a clip.

**`MinorVersion` leads with the real product version** (`"12.0_12402"`); `MajorVersion` is the
schema's and stuck at 5. Live 12 renamed the master track to `MainTrack`; 11 still says
`MasterTrack`. A v1 set carries neither sends nor groups, so their tracks would arrive as orphans
and the reader says so instead.

**Where a track's clips live moved between versions AND between track kinds** — audio under
`MainSequencer/Sample`, MIDI under `MainSequencer/ClipTimeable`. Rather than hard-code either
path, the reader walks the track and picks clips up wherever they are, using the enclosing tag to
tell Arrangement from Session.

**Only a `<SampleRef>`'s `FileRef` is audio.** A bare `<FileRef>` elsewhere in a set points at a
device preset (`.adv`/`.adg`) or even a VST binary, so scanning for `FileRef` generally would pull
in nonsense. And Live's `<Buffer>` hex is wrapped across lines and indented, so everything non-hex
is stripped before decoding.

**Live's own devices carry no portable state.** There is no VST to load them into, so they are
reported and skipped rather than written as chain nodes that could never resolve. `MixerDevice` is
excluded on purpose: it is the track's own mixer, not something the user placed in a chain. Racks
are containers — the plugins inside DO cross over, and only the rack's own structure is lost, so
the reader walks into a rack's nested `Devices` node and flattens the rack away.

**Live gives no explicit instrument/FX role**, so the first device on a MIDI track is taken as the
instrument and the rest as audio FX — the same approximation the DAWproject mapper makes for
cross-type ordering.

**VST3 keeps its state in `ProcessorState`, VST2 in `Preset/VstPreset/Buffer`**; both are hex text.
Live also exposes the automatable parameters by name, but only a SUBSET — a real set lists 384 of
a plugin's 2276 — so `paramsComplete` is never set for it. `emit.ts` then keeps the preset and
drops those partials by design; they are the fallback for a plugin whose state blob would not
decode.

### Reading a DAWproject: the shapes that occur

**A clip list flattens into absolute-positioned leaves**: `<Notes>` is MIDI, an `<Audio>` file is
audio, and a nested `<Clips>` is a container establishing a child timeline. Leaves are clamped to
their container's window, and a clip matching none of these is dropped — reported through
`ctx.warn` so it is not silent.

**The `<Audio>` of an audio leaf occurs in three places in the wild**: directly under the `<Clip>`,
inside a `<Warps>` when time-stretched, or that same pair nested in a `<Lanes>` lane. A bounced
clip has no `<Warps>` at all, and a `<Warps>` with fewer than two markers means the same as "not
warped" — one marker cannot define a stretch.

### Asking the engine for a plugin's parameters

`src/params.ts` asks the engine to enumerate a plugin's parameters so `emit.ts` can write diffable
text params instead of an opaque `.vstpreset`. The preset is dropped only when the engine reports
that the params fully reproduce the state; the whole step is a no-op without an engine binary, and
a failure returns a human-readable reason so a kept-as-preset plugin is never silent.

**Locating the engine is the CALLER's job.** This is a library, so it takes the binary rather than
guessing where the repo is: a copy of that search living here breaks the moment the package moves.

**The dump cache is keyed by the STATE FILE as well as the plugin.** Two instances carrying
different presets must not share a dump, or the second inherits the first's values and `emit.ts`
then collapses them into one module.

### Mapping a DAWproject (track-based) onto the node model

- each source track becomes a `nodes/` lane carrying its arrangement;
- each plugin becomes a self-contained module (its plugin inline + params); the track's
  ordered plugin chain becomes chain `use` steps referencing those modules, instrument
  first then audio FX, then the lane's own strip, into MIX;
- effect/return tracks become bus subbranch chains (no `from`), targeted by enabled
  sends (a source's terminal fans out to MIX + its send buses);
- the master track's plugins become the run between MIX and OUT (`packages/song/docs/masterChain.md`); with none, the two are a single wire.
