# The module vocabulary

The rationale behind `packages/song-schema/src/moduleTypes.ts` — the type folders, what each one
means, and how a module is NAMED. The file itself is a leaf: no filesystem, no imports beyond
`@studio/graph-model`, because these tables are the one thing everything about a module derives
from and a browser has to read them too.

## The io sources

`IO_SOURCES` is stated as a LIST because the graph decides "sink" by ELIMINATION: an io module is a
sink unless it is a source. A role added without joining that list becomes a silent sink, and a
chain would route INTO the thing meant to feed it. The two roles differ only in where the audio
comes from — `in` is a live interface channel, `file` reads an audio file
(`packages/song/docs/fileInput.md`).

## The five built-in outputs

`MIX` is where the mixer sums — every lane's chain ends there, and it is what the header meter
answers for. `OUT` is the interface. A chain wired `from: MIX` to `OUT` is the MASTER CHAIN, and its
steps process the whole mix on the way out; with no such chain the two are one wire and the mix
reaches the interface untouched. They are built-in NAMES rather than modules on disk — `isSink`
takes them literally, so no project needs a `modules/io/` folder for either, and every demo song
relies on that (`packages/song/docs/masterChain.md`).

`RENDER` and `VIDEO_OUT` are the same two for PICTURE, and exist only on a project that declares a
viewport. `RENDER` is where the compositor sums: every video lane arrives there the way every audio
lane arrives at `MIX`, and carries no parameter for the same reason. A chain wired `from: RENDER` to
`VIDEO_OUT` is the VIDEO MASTER CHAIN — where a `video_effects` or `shaders` module processes the
whole composited frame. Not a `video_transitions` one: a transition is NAMED by a cut rather than
wired, so it is never a chain step (`packages/song-video/docs/transitions.md`).

`VideoPluginDoc` is modelled and nothing compiles it, so a module on this run is drawn and validated
but changes no frame (`packages/song/docs/videoOutputs.md`). Unlike the audio pair these are added
AUTOMATICALLY: a project with a viewport surface and no such run gets one written into its
`graph.yaml`. A song with no picture never sees either name.

`CUE` is the fifth, and the odd one: it is the only built-in output that really leaves the mixer's
sum, for a SECOND PAIR of the interface — the headphones on a DJ desk. `MIX` and `OUT` are a
notation over one bus; `CUE` is a track routed off it, which is what
`packages/song/docs/cue.md` is about. A machine that names no pair plays it nowhere at all, never
into the room.

## `@master`, the owner of a master chain's plugins

A reserved name rather than a flag, so the master run goes through exactly the same step-to-plugin
code as every track and cannot drift from it. `@` cannot begin a lane name — which the sentinels
`@shares` and `@external` already rely on — so it can never collide with one.

## `TRACK_CATEGORY`

Up with the rest of the vocabulary rather than beside the `@studio/…` refs at the foot of the file,
because `moduleEmits` has to ask about it: the five track modules share one category and do NOT
share one signal, which is the one place the folder stops being the answer
(`packages/song/docs/trackModules.md`).

## A shader's own vocabulary

A shader is kept in a FOLDER rather than one file because a shader is a PAIR: swap the fragment and
keep the vertex and you have a different effect on the same geometry. Naming the pair after the
folder is what lets the panel offer "ripple" instead of two half-choices that can be mismatched.
That folder sits beside the module file rather than inside `assets/`, following `base/`: `assets/`
is flat files a param NAMES, and a picker over it filters by extension (`assetExtFor`). A shader is
a directory, so it would have been the one entry in that folder that is not a file.

`SHADER_CATEGORY` and `SHADERS_DIR` are the same word and a different fact, which is exactly why
both are named: one is where shader MODULES are filed in a project, the other is where one such
module keeps its GLSL. `modules/shaders/glow/shaders/ripple/fragment.glsl` reads the coincidence out
loud. A single constant would have made every use ambiguous, and the day one moves it would move
both.

`SHADER_PARAMS` are numbered rather than named, and that is the design: the module cannot know what
a shader will call its controls, and a shader author cannot rename a knob on a panel they never see.
Four is what fits a row of the grid, and 0..1 is the range a GLSL uniform wants — no shader has to
normalise, and no panel has to ask what the units are. They reach the fragment as `uP1`..`uP4`,
beside `uAudio` (`packages/song-video/docs/shaders.md`).

The `shaders` entry of `MODULE_TYPES` is the only module type in the repo whose ports are of two
different signals, and the reason is what a shader is for — a visual that MOVES with the sound. The
audio port carries no picture and is never in the flow; it is a side input (`gtr: [ glow#audio ]`),
so the positional check fills `in` from the flow and this one from `step.in`, exactly as a
crossfade's second input is filled. Its `mandatory: false` is load-bearing rather than lenient: a
shader that only uses `uP1`..`uP4` is an ordinary video effect, and requiring a cable to audio would
mean wiring a lane to a shader that ignores it.

## What a lane emits

A lane's signal is its OWN, not its folder's, so `moduleEmits` reads the PORTS. Which means a lane
usually has no answer: it offers `audio` and `midi` both, and `emits` is one word for a cable's
colour. Undefined is the honest one — the same undefined a GROUP gives, and for the same reason:
what leaves a lane is decided per event, and the reader that needs to know asks the run which port
it left by (`Chain.fromPort`).

## `PortDef` and the default ports

`mandatory` is an INPUT's business — an output is offered, never required — and defaults to true
where it is read (graph's `normalizeInputs`).

A module may declare its own `inputs:` / `outputs:` in its `module.yaml`, and then `MODULE_TYPES` is
not consulted at all: the type folder decides what a module IS, and a module that needs two audio
inputs — a crossfade — is still an audio effect. `outputs` is deliberately not derived from `emits`:
`emits` says what KIND of signal leaves (one word, used for cable colour), while a port is a place
something can be wired to.

## `ModuleKind` — four, not two

`plugin` becomes something the engine loads; `io` is an edge of the signal (a source or a sink);
`doc` is neither and is drawn on the graph without reaching the engine at all; `track` is a LANE —
where an arrangement's material enters the signal path, and what a chain is named after. Calling a
doc an `io` sink would have been cheaper by one union member and would have made every "is this a
sink" test answer yes about a note somebody wrote, including the ones that decide what a chain ENDS
on. A lane folded into `io` would be the same mistake from the other side: it is a source, but every
io source is a live channel or a file, and none of the questions asked about those mean anything
about a lane.

## The doc module's ports

ONE input, NO output (`packages/song/docs/docModules.md`). The input is what attaches it: a note is
wired from whatever it is about, so `ampli: [ reverb, notes ]` says "this note is about the amp". No
output, because a note is where a run stops being signal — anything downstream of it would be
documentation feeding audio. Its `audio` port type is not a claim about the note: nothing is
carried, and the graph refuses no wire into it (`docPortType`). It is the type that draws the
ordinary cable, which is what a reader expects to see going into a comment about an audio chain.

## The lane's ports

TWO outputs, because a lane is not typed by what it carries: it holds events naming clips and events
naming sequences in one list, and each leaves by the port its own material fits. The three built-ins
state the same pair themselves (`trackModule.ts`); the `MODULE_TYPES` entry is the default a node
inheriting the category gets.

NO input, deliberately. What arrives on a lane is its clips, and the one thing that may be routed
into it is a live interface channel — which the compiler lands on the lane rather than wiring
through a port, because the flat model the engine plays cannot express routing into a lane's input.
That is an engine ceiling rather than a name-space artefact (`validate`'s out-check).

## `categoryForRole`

The single answer to "what folder does a scanned plugin belong in". It reads as a filing rule and is
really what decides the module's PORTS — a midi effect takes midi and gives midi back, an instrument
takes midi and gives audio — so the engine catalogue and the folder writer cannot disagree.

## `@engine`, and why the ref is built here

`engineRef` lives here rather than in `engineCatalogue.ts`, which reads the scan cache off disk:
naming a ref must not cost a `node:fs` import, or the médiathèque could not scaffold one from a
browser.

`@engine` is the one namespace with no folder anywhere (`moduleNamespaceOf`), and the only one whose
size is a property of the MACHINE rather than of the work: a rig with four hundred plugins has four
hundred of these. So it is the one namespace that is BROWSED — the file tree's Libraries tab — and
never offered as a module name to complete, where it would bury the handful of modules a song
actually has under a vendor catalogue. It stays the vocabulary for `extends:` (`baseModuleRefs`),
which is the opposite question: "what may I inherit from" is exactly where the engine's catalogue is
the answer.

`engineModuleOf` is ONE rule, here, because two tiers apply it and they have to agree exactly.
`engineCatalogue` synthesises the catalogue from the scan cache on the machine; a BROWSER resolves
`extends: "@engine/…"` against the same scan reported over the engine's socket, having no project
loader and no `node:fs`. A browser that spelt the type differently would preview a plugin the
compiled document never loads — silence, with a panel drawn over it. It takes the FORMAT lowercased,
never the role: a role of "instrument" says nothing about whether the plugin is a VST3 or internal,
and reading it as one mislabels every VST3 instrument on the machine.

## The io modules the engine provides

One IN and one OUT for the whole app — a project makes nodes of them, and those carry the channel,
the monitoring and the trim. The nodes belong to the song that records through them: a folder plus a
node per interface channel in `_modules` would put one rig's wiring in a library every song reads.
`FILE` is audio off disk rather than off an interface — one module like the other two, and a node
carries WHICH file, or carries none in a chain template where the audio belongs to whatever the
template is applied to (`packages/song/docs/fileInput.md`).

They are in this leaf rather than in `engineCatalogue.ts` because a node saying
`extends: "@engine/IN"` declares no `io:` of its own, so ANYTHING asking what kind of module it is
has to consult this table — including an editor in a browser, which cannot pay a `node:fs` import to
find out.

## Module status

A library grows past the point where every module in it deserves equal billing: half a project's
modules are things you name every day, and the other half are a compressor somebody wrote once and a
test rig nobody should be offered. `status` is the field that says which, and it changes no sound and
no wiring. A `hidden` module still loads, still plays and can still be NAMED — a completion list is
an offer, never a validator — which is what keeps this an ergonomic setting rather than a way to
break a project from a dropdown. Absent means `listed`, and `listed` is never written: the loader
applies the default, so a file that has nothing to say about this says nothing (the rule `type:`
follows). Full rationale: `packages/song/docs/moduleStatus.md`.

`moduleStatusOf` is deliberately forgiving: an unreadable or half-written module answers `listed`
rather than vanishing. Losing a module from the completions is the one failure this field must not
have, since nothing on screen would say why.

`completionOrder` is STABLE within each group, which is the whole contract: callers hand it an
alphabetical list and expect it back alphabetical, in two blocks. A sort here would be a second
ordering rule competing with theirs.

## File-valued params

`FILE_PARAMS` names the params whose value is a FILE the plugin loads rather than a number. It is
here, beside the rest of the module vocabulary and free of `node:fs`, because three tiers need the
same list: the loader resolves them against the module's `assets/`, `nodeProject` lifts them off the
wire (which stays numeric), and the panel draws them as a dropdown of that folder rather than a
knob. A param not in this list is a number, and that is still the overwhelming majority.

`assetExtFor` derives the extension from the param's NAME rather than from the widget that picks it,
because those two facts have never disagreed: the param is named after the format it loads. A widget
that had to repeat it would be a second place to get it wrong, and its author already wrote
`bind: nam`. It sits beside `FILE_PARAMS` and free of `node:fs` because the PICKER runs in a
browser: the panel filters the module's assets down to the ones its param can take.
`moduleAssetChoices` reads disk and is the node-only half.

## `offline`, the plugin type that never reaches the wire

`OFFLINE_TYPE` lives here and not in `@studio/engine-protocol/build` beside `JSDSP_TYPE` because
there is nothing for the engine to load. That is also why it must be a WORD: the compiler's gate
drops any type it does not know, silently, and a module dropped for being unknown is
indistinguishable from one dropped for being offline (`packages/song/docs/coldModules.md`).

## `@studio/doc`

It names no folder, exactly as `@engine/nam` names none
(`packages/song/docs/moduleNamespaces.md`): there is one doc module for the whole studio and nothing
to scaffold, so a note costs one file — its node — and nothing else. It is the second module in the
repo that exists without a file, and the first that exists without an engine behind it either. A
note is a node because that is what a node IS here: one USE of a module with its own settings. Two
notes are two nodes of one module for the same reason two 4OSCs are; their setting happens to be
text (`content`) rather than a number. `@studio` is its own level and not `@engine`, deliberately:
the engine never hears of this.

## The track modules

Like `@studio/doc`, none of them has a file anywhere: there is one set for the whole studio, so a
lane costs exactly its own node. Three and not five, because a lane is NOT typed by the signal it
carries: it holds events, each of which names a clip or a sequence and is therefore audio or notes
on its own, so the lane offers BOTH outputs and every event leaves by the one its material fits.
What is left to say is where the events come from (written down, or streamed) and whether this is a
relationship rather than a lane at all (`packages/song/docs/trackModules.md`).

`TRACK_OUT_AUDIO` / `TRACK_OUT_MIDI` / `TRACK_OUTPUTS` are re-exported from `@studio/graph-model`,
beside `splitPort`, and for the same reason: the RENDERER draws a jack per entry and does not depend
on this package, so a second copy here is where the sockets and the ports would come to disagree
about how many there are or which is first. The re-export is because this is where every
module-vocabulary caller already looks. The same holds for `PORT_SEP`, `portRef` and `splitPort`:
`graph-model` is a types-only tier with no dependencies, the one place BOTH the compiler and the
graph renderer can reach, and `ui-chains` draws ported edges while deliberately not depending on
this package (`packages/song/docs/ports.md`).

`LEGACY_TRACK_REFS` is kept as NAMES the way `LEGACY_MEDIATEK_NS` is: a file saying
`@studio/sequence-track` names a module that does not exist, and the loader is entitled to say which
one it means instead of leaving a reader to guess. There is no migration code, deliberately — the
same call `packages/song/docs/nodes.md` and
`packages/song/docs/trackModules.md` already made.

## The four levels

A ref carries the level as its `@` prefix — `@engine/audio/nam`, `@st0/…`, `@workspace/…`,
`@project/…` — and a BARE ref (`audio/reverb`) is the project level written the short way. `engine`
is the odd one: it names no folder at all, since a scanned plugin is synthesised by
`engineCatalogue` from the machine's scan cache, so it is a level without a root.

The list lives here and not beside `moduleNamespaceOf`, which decides a level from a folder on disk:
this is the vocabulary, and a browser has to spell it too — st0's Libraries tab writes `@st0` on a
row, and `sharedFolders.ts` reads the disk on its first line, so importing it there would drag
`node:fs` into a bundle.

**`@st0` names the MÉDIATHÈQUE — `apps/pl8` — and not the app called st0.** So the one level that
reads like an app is the only one that names a different one, and it DELIBERATELY does not follow a
rename. A level is written into user files: every `@st0/…` in every chain of every repository would
have to be rewritten at once, on machines this repo does not have, and the failure is silent enough
to be nasty (a `?` on a graph node, nothing else). An app is named for where it sits on the origin;
a level names a folder of modules.

`LEGACY_MEDIATEK_NS` is kept as a NAME rather than as an accepted spelling — nothing resolves it. A
file saying `@mediatek/…` names a module that does not exist, which the loader reports as such; the
constant exists so the migration and the diagnostics can say that word out loud instead of spelling
it inline in three places. It is also the measure of what a level rename costs, and the argument for
not spending it again. See `packages/song/docs/moduleNamespaces.md`.

## `_libraries` and `_modules`

`LIBRARIES_DIR` is where the account's library repository is mounted, at the workspace root: a git
submodule put there by the file service, holding the two families a project inherits, `modules/` and
`chains/`. It is what `@st0/…` resolves against, and not the machine-wide `<state>/mediatek`
cache. Fixed, and not declared anywhere, by the argument that leaves `modules_from` dead: a path in
a `project.yaml` can be wrong about a folder the loader can simply look for. Both it and
`SHARED_MODULES_DIR` are here rather than beside `moduleLibraryDirs` because a
browser names these folders too — st0's file tree keeps `_libraries` off the Project tab, since it
has a tab of its own — and `sharedFolders.ts` reads the disk on its first line
(`packages/song/docs/sharedFolders.md`).

## The three spellings a built-in answers to

`builtinParams.ts` indexes every built-in plugin by all THREE spellings a module may reach it with,
lower-cased.

The first two are the TypeScript twin of `resolveBuiltInType` in the engine's `EditBuilder.cpp`, and
deliberately its rule: a project may write the human form (`Chorus`, `Mixer`) or the internal id
(`chorus`, `studio_mixer`), and both must find the same plugin. That function matches on `name` or
`identifier`, case-insensitively; so does this. The two disagreeing would be the worst shape
available — a module that plays perfectly and shows an empty parameter list, or the reverse.

The third is the SLUG, and it is the one a library module actually uses. A module that is the face
for a plugin the engine provides states nothing else at all — this is the whole file:

```yaml
# _libraries/modules/instruments/4osc/module.yaml
extends: "@engine/4osc"
```

`@engine/<slug>` is `slugifyPluginName(displayName)`: the one rule `engineModuleOf` applies on the
machine and `baseModuleRefs` applies in a browser. It is spelt there a third time by CALLING that
function rather than by restating it, which is the whole reason it sits in a leaf free of `node:fs`.

Neither derived spelling overwrites a TYPE: a type is the addressable one, and "Delay" being both
would otherwise depend on which came first in the object. The map is built once at module load,
since it is read per base module per hints gather.

`builtinPluginForRef` answers only for the engine namespace: a `@st0/…` or a project-local ref names
a FILE, which has to be read and resolved, and this is the seam for the case where there is nothing
to read.

## Module keys

`moduleRefOf`: an io module carries no type folder in its ref, which is why this is not just
`${type}/${name}`.

`moduleKeyFromPath` takes everything between the type folder and the filename, because a module may
be FILED one level deep (which is how the médiathèque lays its catalogue out, and therefore how the
bench's own `modules/` looks):

```
…/modules/audio/reverb/module.yaml              → reverb
…/modules/audio/amps/neural-amp-modeler/ui.yaml → amps/neural-amp-modeler
```

Taking the folder immediately above the file instead gives `neural-amp-modeler` — a name no chain
uses and no lookup finds, which reads as "this project has no such module" about a module plainly in
the tree. It returns null when the path names no module. It is in this leaf rather than in the
loader so a BROWSER can ask: `@studio/song/loader` opens `node:fs` on import, and this is a question
about a string. It searches the LAST `modules/` segment so a workspace-relative path
(`song.st0/modules/…`) and an absolute one both land on the same place.
