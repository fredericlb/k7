# `projectEdit.ts` — changing a project in its own vocabulary

`projectEdit.ts` is the layer that turns "set `Filter Freq` on module `synth`" into a write:
it finds the file a NAME lives in and hands the change to the YAML writer for that kind of
file. It is not `yaml/edit.ts`, the file primitive — this one knows modules, nodes, clips and
chains, and nothing about YAML beyond calling a writer. Every write changes the value and
nothing else: comments, key order and layout all survive, and no format pass runs afterwards
because the writers emit canonical output.

This page holds the reasoning the functions used to carry inline.

## Where a module's file is

Three cases, and `moduleFileOf` picks between them:

- a **node** carries its own `home` folder and has no category to rebuild a path from;
- a **module** is `modules/<category>/<file>/` — `module.*` for the generic, `<node>.*` beside it;
- a **shared** one, `"@engine/io/IN:in-2"`, whose file lives in the workspace's `_modules` and
  not in this project at all.

That third case is `sharedModuleFileOf`, and it returns null for anything that is not a
namespaced ref. Writing there changes the module for every project beside it, which is right
for what lives on ONE desk rather than in one song — an input's `channel:` describes the rig,
and so does whether that input is audible. It is not a general licence to edit the library:
`forkSharedModule` still owns the case where an edit belongs to one song, and the file service
still refuses the library outright. Only a caller that has already decided otherwise gets here.

## Attribute sets (alternatives)

`moduleAlternatives` reads the FILE rather than the compiled doc, and that is not an
optimisation. An alternative may change any field, so the doc carries the chosen one already
merged in and has nothing left to say about the others. It sits here beside the writers so
`moduleFileOf` can stay private — one place knows where a module's file is.

`newModuleAlternative` resolves the module before deciding what an empty set means. A LANE's
empty one is empty of PLACEMENTS: a new take that opens holding the previous take's clips is
not a new take. It has to read the module RESOLVED, not as loaded — `loadModules` hands back a
node with its `extends` still a string, and `kind: "track"` lives on the built-in it extends.
Both reads are memoised on the module folders' stamp, so this costs a directory walk and not a
re-read, and a name that resolves to nothing simply is not a lane. Deciding it here rather than
in the document editor is deliberate: the question is what this module extends, and the
vocabulary to answer it lives on this side.

See `packages/song/docs/alternatives.md` for the format.

## Fields that are not params

Several module settings are FIELDS rather than entries in `params:`, and the difference decides
how each takes effect. A param is sent to a running plugin; a field is learnt by REBUILDING
something, which is why the caller reloads instead of patching.

| field | what it says | why not a param |
|---|---|---|
| `monitor` | `off` \| `auto` \| `on`, whether a live input is audible | an io module has no plugin to send it to; the engine rebuilds the track's input |
| `channel` | which interface channels an input listens on, 1-based | same, and it may land in a shared file: which socket an input is on describes the desk |
| `gain` | the interface trim in dB, 0 being unity | same three-field family as the two above |
| `base` | which named `.vstpreset` the module starts from | a preset is loaded when the plugin is CREATED, so the engine relearns it by rebuilding |
| `shader` | which shader folder this node runs | the four knobs steer a program already running; this decides which program is compiled |
| `frozen` | the render this module plays instead of its inputs | see `packages/song/docs/freeze.md` |

`channel` is one number for mono, two for a stereo pair, and the two-element form only ever
means a pair the interface actually groups: `findWaveInput` matches a device on its exact
channel list, so a set the rig does not offer resolves to nothing and plays as silence (see
`engine/moteur/docs/audioDevice.md`). Whether such a pair exists is the ENGINE's business and
not checkable from here — the writer writes what it is told, and the surface offering the
choice is the one that only offers real ones. `gain` is unclamped for the same reason:
Tracktion does not clamp it either, and what is USEFUL (±24 dB, the range the builder's binds
declare) is a judgement for the surface, not for a writer taking a number someone typed.

`base` is PER INSTANCE, because the write lands in the module's own file and a node has one:
two nodes of the same module can sit on two different bases, which is the point of choosing at
all. And it cannot disturb what the module already said — the engine loads the base and then
applies `params:` over it, so every authored value still wins and a base only decides what text
could not have said (`packages/song/docs/userPresets.md`).

`shader` is deliberately NOT checked against the folder, the same posture `base` takes. Which
shaders exist is a fact about a disk this may not be on; the dropdown offers only what
`moduleShaderChoices` listed, and a name whose folder is missing is already handled where it
matters — `readShader` returns null and the pass falls through. Refusing here would mean a name
could not be typed before the folder it names is synced.

Both `shader` and `base` REMOVE their key when handed an empty string rather than writing
`: ""`. The schema's `min(1)` would refuse that anyway, and a node running no shader is one
with no line about it, not one holding an empty name.

`frozen` is refused outright on a shared module. It is a fact about THIS song's signal path —
the render was bounced from these lanes — and a catalogue module sits beside every project at
once, so writing it there would freeze a reverb in songs that have never been rendered.
`monitor` goes the other way deliberately; this one does not.

## A clip name is half a placement id

`clipFileOf` strips the `@<beat>` before building a path, and that is the fix for a bug worth
recording. A clip on a lane is `bass_2_0@16` (`placementId.ts`): the material, and where it
plays. Everything in the clip section is a property of the MATERIAL — the stretch map, the
onset corrections, the file itself — and is shared by every placement of it.

It did not strip it, and the failure was the loud kind for once: `no clip "sy.chrpan2_…@106" in
this project`, raised while placing a stretch point from the waveform. Every surface that draws
a clip holds the placement id, because that is what the compiler put on it and what `/waveform`
is asked with — so the verbs `clip warp` and `clip onset …` were reachable only by typing a
material name by hand.

Fixed HERE and not in the callers, for the reason the file service fixed it at its own boundary
(`waveformOps.ts`, `workspace.ts`, both carrying the same note): there is one rule, and the
place that turns a name into a path is where it belongs. `materialRefOf` returns a bare material
name unchanged, so a hand-typed one is untouched.

`missingClip` exists for the other half of that story: the old message named the id alone, which
for a placement is the one string that is NOT the file's name — it pointed at
`sy.chrpan2_…@106` while the thing missing was `clips/sy.chrpan2_….yaml`. Naming both is what
turns "this is broken" into "that file is gone".

Two more rules in that section. Onset corrections that cancel out take the `onsets:` key away
rather than writing `onsets: {}` — a clip nobody has corrected must read exactly as it did
before anyone opened it, or every take in a session grows an empty block that says nothing and
shows up in every diff. And `clipWarpMarkers` does no resolution and no defaulting: a clip with
no `warp:` has no map, which is a different thing from an identity one. The `algorithm` on
`setClipWarp` is only used when the block is being created — the engine ignores it entirely,
realising a warp through Tracktion's auto-tempo, so the name is documentation of where the map
came from and is written only because the schema requires it.

## One graph file, project or chain

`graphFileOf` is what every chain verb goes through, and it is what lets the graph editor act
on a library CHAIN template without a single verb knowing it might be one. That costs nothing
to arrange because a chain is not a lookalike: it is a folder holding a `graph.yaml` and a
`nodes/`, the same two things a project holds, differing only in having no `project.yaml` and
in naming its ends `@in`/`@out`.

Bypassing needs no chain name any more: the file names each module once, so there is one thing
to toggle rather than one per chain the module happened to sit in.

## Repointing, unlinking, renaming, deleting

`setModuleExtends` rewrites ONE line of ONE file and that is the whole of it. The file stays
where it is under the name it has, so its position on the graph, its panel and its alternatives
survive; only what it IS changes. Three keys are dropped on the way — `plugin`, `params`,
`rack` — because they described the thing it used to be and, left behind, would either outrank
the new ref (`plugin` wins over an inherited one) or address knobs and sounds it has not got.
The ref is checked against the project's real vocabulary rather than a guessed path: an
inherited `@ns/…` has no local file to stat, and a typo must be refused before anything is
written. Repointing something at itself is refused for the reason the resolver guards its walk —
an `extends` cycle resolves to nothing at all.

The `node replace` VERB may then RENAME the node, when its name was one the convention made and
is therefore about to start lying about the module under it (`renameChainNode`, and
`renamedInstance` for the judgement). That is a second act on purpose: this one cannot fail
halfway, and a rename touches a file, a preset and every chain step that spells the name.

`unlinkChainNode` takes a node out of the SIGNAL PATH, joining what fed it to what it fed, and
leaves it in the graph wired to nothing. Its files are untouched and so is its place on the
canvas: unlinking is "take it out of the run", not "get rid of it". Putting it back is `node
insert`; removing it altogether is `node delete`. A node may be named as a step or only ever as
somebody's destination — the last module in a run has no entry of its own, and it is still in
the chain and still unlinkable. A LANE used to be refused here, because a chain started at it
and there was nothing feeding it to rejoin to what it feeds; a lane is a module now with an
input port of its own (`packages/song/docs/trackModules.md`), so the splice is well defined.

`renameChainNode` and `deleteChainNode` share a footprint — a node is `nodes/<name>.yaml` plus,
when it has one, `nodes/<name>.vstpreset` — and an ORDER that is load-bearing. The FILES go
first and the chains second, because the state to avoid at all costs is a `graph.yaml` naming a
node with no file: that is what stops the project loading, and it is the half a person cannot
see. Interrupted the other way round you get an orphan file, which loads fine and is merely
untidy. Renaming has no safe order at all — whichever half lands first, the other is dangling
until it does — so the check that the destination is free happens BEFORE anything moves, and
that is what keeps it from being a real risk.

Neither touches the MODULE. A node is one use of one, its name is the key a chain writes, and
deleting the last use is not a statement about the thing being used — other projects read the
same module.

`laneOfNode` answers which lane's chain plays a node, which is what an instance name is built
from (`instanceName.ts`). The answer is `chainsUsing`, and it is `moduleFork`'s: naming a fork
after its track and naming a node after its lane are the same question. It takes the FIRST when
several chains reach it, the same arbitrary-but-stable choice a fork makes.

`replugChainNodes` moves ONE end of an existing arrow in one read and one write, so however the
two halves are spelt the file changes atomically: a crash between "pulled" and "plugged" cannot
leave the cable half-gone.

## What went

`deleteModule` was here: it removed a module's file or folder AND every chain step naming it,
since a step pointing at a module that is gone is a dangling reference the compiler refuses to
load. It went with the `module delete` verb that was its only caller — removing a module's
files is the file tree's business now, and `unlinkChainNode` is the other half it used to
bundle in.
