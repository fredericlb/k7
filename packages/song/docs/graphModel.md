# The graph model — `graph.ts`, `loader.ts`, `nodeProject.ts`

Three files sit on one axis: `loader.ts` reads the folder, `graph.ts` assembles the
`GraphDoc` a surface draws and checks it, `nodeProject.ts` compiles the `ProjectDoc` the
engine plays. This page holds the reasoning behind the three, which the code points at rather
than carrying inline.

`nodeProjectLayout.md` describes the FOLDER; this page describes the MODEL built from it.

## A lane is a projection, not an entity

`Track` is a node of one of the five `@meta/…-track` modules (`trackModules.md`) seen as
an arrangement rather than as a node. The shape is kept deliberately: the compiler, the wire
and the engine all speak it, and the engine's lanes are a compilation target rather than the
authoring model — exactly as the `Mixer` module's fader is.

A single lane holds placements; a group holds member names; a strudel lane links the pattern
its material streams from. The fields of the other kinds are always present but empty, so
callers can read any without narrowing first.

There is no `contentType`. A lane is not typed by what it carries — each PLACEMENT is
(`Placement.kind`). A reader that wants the summary asks the placements, and gets "both" as an
honest answer, which one word at the top of the file could not give.

`Track.mute` is read off `graph.yaml`'s `bypassed:`: a lane's mute IS its module's bypass, which
is why the lane file carries no `mute:` for the two to disagree over. `Track.solo` is always
false — solo is a session state the surface derives, by bypassing every OTHER lane — and the
field goes once the wire and the engine drop it too.

A DISABLED lane is ignored everywhere: the engine never sees it, the timeline draws nothing for
it, and `buildGraph` drops it along with every chain sourced from it. The graph is a picture of
what the song actually does, and a lane that plays nothing routing through a chain that runs
nothing is a lie in the shape of a diagram. The file stays on disk, ready to be re-enabled, and
`GraphDoc.disabledTracks` keeps the ids so `validate()` can tell "you disabled this" from "this
doesn't exist" — a group listing a disabled member is fine, a group listing a typo is not.

Video lanes are kept SEPARATE from `tracks` rather than mixed in: nearly everything that reads
`tracks` is audio logic (groups, placements, the mixer, chain input typing) and a video lane
satisfies none of it. They are on the model so the graph and the timeline can show them, and so
a chain sourced from one resolves instead of reading as a dangling reference. There is no
`disabled` counterpart either: a video track is switched off with `mute` (== hidden), and every
one has to be listed in `project.layers`, so there is no "left out" state to model.

## `Out` is `WebOut`

`Out` is an alias of `@studio/graph-model`'s `WebOut`, not a second declaration: two
field-for-field identical types are how a field like `fromPort` gets added twice. The name is
kept because it reads better inside a compiler that has no "web" side; the type is one. See
`ports.md`.

An output port has no `mandatory` twin: an output is offered, never required — nothing is wrong
with a jack nobody plugged into.

## What a module carries past its params

`Module.outputs` sits beside `emits` rather than being derived from it: `emits` is one word for
the cable's colour, a port is a PLACE something plugs into, and a module may offer several — the
graph draws a jack each. `emits` in turn is not derivable from `inputs`: an instrument and a midi
transformer both take midi, but one hands back audio and the other midi.

`category` is the module's TYPE FOLDER, and it is kept although `emits` is derived from it: the
derivation throws the distinction away (an instrument and an audio effect both emit audio), so
the graph needs the folder itself to pick an icon.

`base` and `shader` are FIELDS rather than params for the same reason: a preset is loaded when
the plugin is BUILT and the params above are applied over it, and a shader field picks which
program is compiled while its knobs steer it. See `userPresets.md` and
`packages/song-video/docs/shaders.md`.

`rack` is resolved here beside `ui` and `cc` because it is the same kind of fact — what the
module IS, rather than how it is wired — and a surface drawing a pad per sound should not have to
re-run the `extends` merge to find out what it loads.

`nam` and `assets` are both halves of every file-valued param: the absolute path the engine
loads, and the name it was authored with. `validate()` needs the pair — a name with no path is a
file the module's `assets/` does not hold, and silently loading nothing would sound like an amp
that isn't there: quiet, and unexplained.

`content` is a NOTE's text on a doc module. It is the only place prose about the signal path
lives, and it sits IN the graph, wired from what it is about. See `docModules.md`.

`alternatives` / `alternative` are carried AFTER the merge, deliberately: the fields above are
already the chosen set, and these say what could be chosen instead. Absent when the module has
only its own, so no node grows a menu it has nothing to put in. See `alternatives.md`.

`channel` is as DECLARED — a preferences label stays a label, because this doc describes the
song rather than the rig it runs on. `nodeProject.ts` resolves it to physical channels.
`positions` likewise rides through untouched: nothing about the SIGNAL reads it, and the
renderer's layout places only the nodes with no entry.

## Typing a chain source

A lane is DETYPED: it offers both outputs, so what it emits is decided one of two ways. Name the
port (`melody#midi`) and the port is the answer, flatly. Name the lane bare and the answer is
what the lane actually HOLDS — audio if every event names a clip, midi if every one names a
sequence, and undefined when it is empty, mixed, or names something unresolved, which is the
caller's cue to skip the check rather than guess.

So `trackType` reads the events. That is not a guess at a fact the file failed to state, it IS
the fact: a lane holding a riff and a line holds a riff and a line, and no word at the top of the
file can be more true about that than the events are. A group carries no signal of its own, so it
is never a chain source.

A VIDEO track types as "video", which is what lets a chain run one through `video_effects` to
`VIDEO_OUT` and be checked like any other. Without it a video source types as nothing and the
whole video-chain half of the model cannot be reached from a real song.

`buildGraph` tells the derivation which nodes are lanes, and a video lane counts: it lives in
`video_tracks/` rather than in `modules`, so nothing else recognises it and `main: [ glow ]` would
read as a run whose first STEP is a module called `main` — reporting the lane as "not a module or
module node", about a file sitting right there. One map, one name space, both kinds of lane.

## What ends a run

`isSink` accepts the built-in outputs by name: `OUT`, `MIX`, `RENDER`, `VIDEO_OUT`. A project
needs no `modules/io/OUT` folder for them to work and every demo song relies on that; requiring
the folder would make all four warn that the OUT ending their chains "is not a chain or io sink". `MIX`
is the mixer's own sum and `OUT` the master run that carries the whole mix out (`masterChain.md`);
`RENDER` and `VIDEO_OUT` are the picture's pair, asked by the same rule (`videoOutputs.md`).

A NOTE ends a run too, and legitimately: a doc module takes one input and gives nothing back, so
a chain routed to it terminates there exactly as it does at an output. Without that, the graph
reports every wired note as "not a chain or io sink" — a warning about a comment, on a project
that is correct. It is a sink by SHAPE rather than by role, which is why it is asked separately
from the io test.

An io module is otherwise a sink unless it declares itself a SOURCE: routing a chain to an input
is meaningless, so the source roles are excluded rather than silently accepted as a destination.
The list is `moduleTypes.IO_SOURCES`, read and not restated — a role missing from it would become
a sink by elimination, silently.

`isInputModule` is deliberately narrower than "is a source". Everything it gates is about a
physical input — which track it lands on, whether you monitor it, its trim, whether the rig has a
channel by that name, the tuner — and none of it means anything for a file. A file source is
`isFileInputModule`; both emit audio, and that is all they share (`fileInput.md`).

## A chain a module runs inside

`deckB: [ crossfade#b ]` reaches a module that is a STEP of deckA's run — `chainsGraph.ts`
deliberately does not let a side input absorb its target — so there is no chain called
`crossfade` to look up, and every walk over `out` edges needs the run that CONTAINS it instead.
Absorption gives a module at most one host, so `chainHosting` may return the first hit.

That is also why `reachesSink` and `hasCycle` continue through `chainAt`: a deck wired to a
crossfade's second port read as a dead end, which is the one thing it demonstrably is not, and a
loop drawn with side inputs is exactly as unplayable as one drawn with bare ones.

## The cold rule lives in one place

`coldPlacementError` is THE one place the cold rule is decided. Every surface that can add a
module to a chain calls it — the commands, and whatever the chain views wire to them — because a
rule enforced in two places is a rule that will be enforced differently in one of them.

The rule: a cold module's chain must draw its signal from a FILE. Not merely "not live" — a file
specifically, since that is the only source whose whole length is knowable before playback. It
takes the MODULE rather than its name because the commands ask before creating anything: the
coldness is a fact about the thing being placed (or about what it extends), knowable while
nothing has been written yet, which is what lets a refusal leave no folder behind.

Placing a module wired to NOTHING (`at` undefined) is allowed: there is no input yet to be wrong
about, and the refusal comes when it is wired to something. Refusing earlier would mean refusing
to write a module you are about to give a file to. See `coldModules.md`.

## Where a live input lands

`inputLandingTrack` returns the run's own source track when the input is a step ON it, else the
TRACK its run ends at. The second form is what `"@engine/io/IN:in-2": [ ge.rythm ]` says, and it
is the one that reads correctly — signal comes FROM an input, INTO a lane. The first is a run
that names its track up front with the input as a node inside it; both work, because both are
written.

### …and a run that reaches NO lane makes its own track

A rig has nothing arranged: `IN -> fader -> OUT`, no lane anywhere. The engine assigns an input to
a TRACK and to nothing else, so such a run used to hand its input nowhere and compile to silence,
with the graph still drawing the cable — the worst version of being wrong.

It now MATERIALISES a track of its own, named after the chain, carrying the run's plugins. That is
the same thing a BUS already gets and for the same reason: the document names a run, and the
engine's model needs a strip. `inputChains` in `nodeProject.ts` is the whole of it, and it is one
arm added to `ownerOf` beside `busChains`.

So `validate()` no longer demands a lane. What is left of that check is the part about a lane that
IS named and is disabled or absent. See packages/song/docs/liveProject.md.

An input is therefore wired by the RUN it sits in, which is why `validate()` walks the chains
rather than the modules for this. `channel` anywhere else is silently ignored, which looks like it
took effect — hence the warning.

## What `validate()` guards, and why each one is there

- `from` may name a track or ANOTHER chain, never itself. Excluding self is not pedantry: a chain
  takes its name from its source track, so an unnamed chain is called exactly what its `from`
  says, `g.chains[c.from]` would find ITSELF and a dangling source would look resolved. `MIX`
  and `RENDER` are exempt — every scaffolded project writes `MIX: [ OUT ]`, and every project with
  a viewport gets the `RENDER` line automatically, so leaving them out warned on all of them at
  once about the one line that is always right.
- A DETYPED lane wired bare into a run whose first module takes one kind warns and names the two
  keys that split it. Wiring a lane bare means "everything this lane emits, down here", which is
  right for a lane holding one kind of thing. Once it holds both, a synth is handed the audio clips
  too and passes them through or eats them depending on the plugin — neither a crash nor what was
  intended.
- Routing INTO a live input is checked ahead of `isNode`, which says yes: a module the signal
  stops at starts a chain of its own, so an input at the end of a run resolves perfectly and does
  nothing.
- Only a live input's signal may land on a LANE. A track's material is its clips, so an ordinary
  module aimed at one is silently discarded.
- `out.fromPort` is checked on the SOURCE side as well: a wrong destination port throws in
  `checkChainInputs`, while `sep#vocls` would route silently — the derivation drops the typo and
  the cable lands on the module's first jack.
- A group is not a chain source: it holds no material, and it is not a lane the engine plays, so
  the compiler would drop the chain's plugins on the floor without a word. Fatal in
  `checkChainInputs` rather than silent there — wiring a chain to a pattern's group is the obvious
  thing to try, and a strudel lane is what you want instead.
- The engine assigns ONE input per track, so a second would silently replace the first: both are
  named rather than letting the last one loaded win.
- Disabled reads as absent, so the messages say which it is — "not found" sends the reader hunting
  for a typo in a file that is sitting right there, only switched off.

There is no refusal about what the landing lane HOLDS. An interface input carries audio, and a
lane has an audio output whatever its material, so the input lands on that half — which always
exists, leaving nothing to refuse.

`checkChainInputs` fills ports in order: the chain flow (the previous step's output, or `from` for
the first step, or the summed sends of a routed-into bus) fills the first port, and a step's `in:`
sources fill the rest. A module that declares no ports is unconstrained and skipped. Its result is
FATAL — a mis-wired project fails to read — where `validate()` only warns.

`checkInputLabels` is kept OUT of `validate()`, which is pure, because whether a channel label
exists is a machine question: the answer depends on `<state>`, not the song, so the same project
warns here and not on the rig the labels were written for.

## The `— did you mean` tail

A node is a `<name>.yaml` BESIDE a module.yaml, not a folder inside it, so the ref of one is the
module's ref with `:node` — and the two spellings look identical to anyone reading the folder on
disk. `nodeHint` is worth a hint rather than a second guess at the docs: "is not a module" is true
and useless, and the whole difference is one character. See `moduleNamespaces.md`.

## The CLI entry guard

`graph.ts` runs `main()` only when this FILE is the entry point. The
`import.meta.url === argv[1]` test alone is not enough: bundlers rewrite `import.meta.url` to the
bundle's own URL, so when this module is bundled as a library into another entry (the packaged
file service) both sides match and the CLI would hijack startup. Requiring our own filename keeps
that from happening.

## Compiling a placement into a clip

`placementId` and its inverse live in `packages/song-schema/src/placementId.ts` — two lines of rule
with no imports, so the BROWSER can hold them too (the context menu hands the editor a placement
id). `nodeProject.ts`
re-exports them because that is where every existing importer looks, and IMPORTS them as well:
`export … from` re-publishes a name without BINDING it locally, and `placementToClip` calls
`placementId`.

A clip's `id` is the PLACEMENT's identity, not the material's — `name` is the material, and the
two are only the same string while a material is placed once. A SPLIT makes two placements of one
material by definition, so `id: ref` would give both halves one id: the engine indexes clips by
it, `emplace` keeps the first and the second is never diffed — "edits to the other will not be
heard", in the engine's own words — and `findClip` picks the first too, so clicking the tail would
draw the head's window.

A window EDGE is always SECONDS, which is what the engine takes and what a window into a file
means. A number is already seconds; a timecode is musical and converted where the tempo is known.
Undefined when unwritten, so "no window" stays distinguishable from "a window starting at 0". A
timecode edge is a POSITION, not a duration: `from: "2:1"` is bar 2 beat 1 OF THE FILE, read
exactly like the `start:` beside it, so `"1:1"` is the file's beginning. Reading it as a duration
("two bars and a beat IN") lands a whole bar late and is indistinguishable from the right answer
until you hear it.

`ClipDoc.event` keeps the placement's own words UNMERGED beside the resolved answer, and only what
the file actually said. An absent field is the default, and writing the default back out would put
an explicit `loop: 1` and two zero fades on every untouched event of a document that is polled
every two seconds — and would then be COPIED onto whatever a paste writes, turning a duplicate of
a plain event into four lines of restated defaults.

The effective window is the clip's own, narrowed by the EVENT's `from`/`to`. The most restrictive
edge wins — the larger `from`, the smaller `to` — so an event can only play less of the material
than the clip declares, never more. An empty intersection compiles like an open extent.

`length` stays 0 only for a clip with no `to`, which means "to the end of the source": a duration
this compiler cannot know without opening the wav, and which the ENGINE fills in from the file it
holds. That 0 is why an untrimmed clip draws as a single bar on the timeline. Passing the window
through cannot make the engine play MORE than it does today — `clipPositionFor` caps an unlooped
clip's end at the window regardless. Repeating is the one case the engine cannot do alone, since
it has no count, so a loop needs a `to`; the compiler refuses a looped audio clip without one
rather than play the first pass and drop the rest.

A sequence's `from`/`to` are POSITIONS in the notes, read like the `start:` on the placement.
Unwritten, the window is everything the notes cover, rounded UP TO THE BAR — not the bare extent,
because a two-bar drum pattern whose last hit is on the fourth sixteenth would otherwise be 3.75
beats long and every repeat of it would drift. Material is written in bars; a sequence that means
otherwise says `to`. It reaches the engine as the clip's LOOP RANGE, which is the only thing that
can say "play from bar 5" — a MIDI clip ignores `offset`. A window the file never wrote needs no
range at all, so it is left unset rather than written as a loop that must never come round.
Intersecting the EVENT's window has NO fallback: an event window disjoint from the material's is
empty and plays nothing, where a malformed material window meant "the file is wrong, keep the
notes".

## `jsdsp` and Faust

A module's DSP graph is RUN — in a child process, because this compiler is synchronous and an
`import()` is not, and turning `loadProject` async would ripple through every caller for one
field. The cost is ~200 ms of Node startup, which is why the result is cached as a sibling `.json`
and only regenerated when the source is newer. Steady state is a file read. That sibling is also
the artifact worth committing: it is what actually ran, it diffs, and a checkout with no Node
still plays the song. The child receives the builder as an argument, so the module's file imports
nothing at runtime — a song folder has no `node_modules` and should never need one.

Faust needs none of that: the compiler is on the other side of the wire, so what the engine wants
is the `.dsp` itself — no child process, no mtime check, nothing to commit beyond the source.

Neither is fatal. A source that throws, or a runner that cannot start, leaves the last good
`.json` in place if there is one; failing that the module falls back to the plugin's own default
graph and the engine says so. One broken effect must not take a song down. What neither can do is
catch a syntax error — only the engine's compiler can, and it reports through the warning channel.

Only a KNOWN plugin format reaches the engine, and a format this gate does not know is dropped
from the compiled doc SILENTLY — nothing warns, because a step whose module compiles to nothing is
how a bypass looks. Adding a format means adding it here (`faustModules.md` lists the four doors).

`params` reach the engine as numbers only. A file-valued param (`nam`) is authored in the same map,
because to the person editing the module it IS one of the plugin's controls, but the wire's params
are `Record<string, number>` mirrored in C++ as a float map and a string there is not a value the
engine could set. It leaves as `namFile` instead, which is what the engine takes — the authored
shape says it one way, the protocol another, and the compiler is where they meet.

## Lane halves

A lane compiles to one engine track, called after the lane, when it is wired the way lanes have
always been wired. It compiles to TWO when its `audio` and `midi` outputs were keyed separately in
`graph.yaml` — `melody#audio` and `melody#midi` — each carrying the events its port fits and the
plugins of the run that left by it.

The engine holds ONE plugin chain per track, so a lane playing a riff through an amp and a line
through a synth is two tracks down there whatever the authoring model says. Detyping makes it one
lane up here whose material sorts itself, rather than two lanes tied together by a naming
convention; the split exists only where the engine's model requires it, which is the same
relationship `Mixer` has with the engine's fader.

The sort is over the LANES rather than the halves, so both halves of a lane take its rank and stay
adjacent: a split reads as one thing in two strips rather than as two lanes that drifted apart in
the list.

A side input may name a STEP in the middle of a run: `chainsGraph.ts` records the feeder by its own
name, so a module wired to a port from inside another chain arrives as a step name rather than as
that chain's. Its signal is its chain's, so the lane is that chain's owner — one level deeper, same
ownership rule. `deckB: [ tempoB ]` + `tempoB: [ crossfade#b ]` is exactly this shape and it
appears the moment a deck gets anything of its own before the meeting point; without it the second
input resolves to nothing and the deck goes SILENT while the chains file, the graph and the panel
all say it is wired.

## Baking an envelope

An envelope is placed by its EVENTS; every other curve is a function of song time. The events are
the note-ons of the lane that feeds the triggering module — which is the lane the automation
already belongs to, since a chain's owner is what plays it. So the note starts are read straight
off the clips already compiled onto that track, and a module fed by nothing simply never fires: an
empty trigger list bakes to no points, and a lane with no points leaves the parameter alone.

Those note-ons are read off the COMPILED clips, so a note's beat is its clip's start plus its own
offset and nothing has to re-resolve a placement. A looping clip repeats its window exactly as the
engine plays it, so a one-bar pattern fires the envelope once per pass rather than once. The list
is sorted and deduplicated: two notes struck together are one trigger, because one automation lane
holds one value — the same reason `bakeAdsr` cuts rather than sums.

## Loading order

Which nodes are LANES has to be settled BEFORE the chains are derived — a run is named after its
lane, and with one `modules:` map only `extends` tells a lane from a reverb. So the local modules
are folded first and the derivation is told. The fold is pure and in memory; doing it twice costs
a walk over a few dozen structs and buys the derivation the one fact `graph.yaml` does not state.

`loadGraph` and `compileNodeProject` both wrap their work in `withModuleStamp`: they ask the
module cache twice, and one stamp walk covers the pair. See `moduleCache.md`. `withModuleStamp` is
re-exported from `loader.ts` because a caller that wants it is, by definition, making several of
the calls there in a row, and that is the door it already came through. It may only be used by a
caller that WRITES nothing: a stale stamp would serve a module under a name nobody wrote.

## Reading the module folders

`readModuleTree` allows ONE level of filing under a type — `audio/reverb` and
`audio/amps/neural-amp-modeler` both, the second keyed `amps/neural-amp-modeler`. It holds for
both shared roots — the workspace's `_modules` and the médiathèque, which files its catalogue that
way too: **two walkers over one vocabulary have to agree.** One that skipped a folder with no
`module.yaml` in it would make a nested module not an error but simply absent, and every symptom
would then describe something else — a chain naming a module "this project doesn't have", a
catalogue short a few rows, and a builder answering 400 for a file sitting right in the tree.

A module file that will not READ is reported rather than dropped in silence, because the shape of
that failure is the problem: the ref simply stops existing, so every symptom downstream describes
something else — "extends unknown module" about a file sitting right there, a catalogue three rows
short, a module that stopped making a sound. The file's own complaint is the answer to all three.
For an INHERITED library it is a warning and not an error: a library holds modules this project may
never name, and one being unreadable is not this project's failure to compile. It becomes an error
the moment something references it, which is where `nodeProject.ts` reads these to say "failed to
load" rather than "unknown".

Each loader hands back a FRESH map of FRESH modules, so a cached read never leaves the file.
Callers ADD to the map they are handed (`ioPorts.ts` files the project's own io modules into it),
and both loaders STAMP panels onto what they hand back — `applyUiLibrary` writes `ui` and `cc` in
place, by two different rules — so sharing either would let one caller's overlay decide what the
next one sees. Aliases survive: a module filed under two refs stays one object.

The ref map keys a module ONCE, under its explicit level (`@workspace/audio/reverb`,
`@st0/audio/reverb`) — there is no bare spelling to key alongside it: a module lives at
`@workspace` or `@st0` now, and a ref always carries the `@` that says which. NODES never enter
this map at all; they are a project's own uses, read separately, and a node's `extends:` is
resolved against this map rather than added to it.

The built-ins are seeded before the catalogue so anything on disk overrides both: a project or a
library may define `@engine/x`, and the thing you can edit should win over the thing you cannot.
The six `@meta/…` modules — the note and the five lanes — are seeded HERE rather than folded into
the catalogue argument because they are not the engine's, so callers that pass their own catalogue
(tests, scripts) still get them, which is what "built-in" has to mean for a ref every project may
name.

The refs a NODE's own panel may be filed under are, best first, its own and then the module it
DERIVES from: a node is one use of something the engine or a library provides, and a panel is
drawn for the thing rather than for each use of it. Without the fallback, a node extending a
shared module orphans the panel drawn for it.

## The DSP source of a module

The PLUGIN TYPE decides which file: `plugin.type: jsdsp` means `jsdsp.ts` in the module's own
folder, `plugin.type: faust` the `dsp.dsp` beside it. ONE statement says both, rather than a field
naming the file beside a `plugin:` block that says nothing about it — two things to keep in step,
and the interesting one is the one nobody reads. So a module with the type but no file is a module
whose source is missing, rather than one that silently loads a graph host with nothing in it. ONE
function covers the two languages and returns the FIELD rather than a path, so the
type-to-filename mapping lives in one place.
