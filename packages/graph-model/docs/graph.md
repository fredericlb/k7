# The routing graph on the wire

`types.ts` is the chains graph as the browser receives it, mirroring the essentials of the song
compiler's `GraphDoc`. Almost all types, plus the handful of values both sides must agree on BY
VALUE. This page is the reasoning behind the fields that are not obvious from their names; the
type file keeps one line each.

## Why this package exists at all

Drawing chains needs none of auth, workspaces and the registry, which is what
`@studio/web-protocol` holds. Splitting the graph off means a surface that only draws one does
not drag any of that in.

The same argument decides what the *values* here are for. `PORT_SEP` and `TRACK_OUTPUTS` are
needed by BOTH sides and neither may depend on the other: the compiler derives chains from port
refs and builds a lane module's ports, while the renderer draws a jack per entry and lands cables
on the jack they name. Stated once here, the sockets and the refs cannot come to disagree about
how many there are or which is which.

## Categories and signals

`MODULE_CATEGORIES` is written as VALUES with the type derived from them, not beside them. Both
halves are needed — the type to write against, and the list to test a path segment against at
runtime — and written twice they drift: drop `midi` from one copy and a transformer authored
under that alias draws as audio on the surfaces reading it and as midi on the rest. Deriving one
from the other makes that impossible.

`shaders` is its own category and not a flavour of `video_effects`, because it is the one module
whose behaviour is a FILE it carries rather than a plugin it names. See
`packages/song-video/docs/shaders.md`.

`WebSignal`'s `event` is the odd one and stays out of the signal path: nothing is processed, an
instant is announced — a note-on that restarts an envelope. It is a `WebSignal` so a socket can be
typed and coloured like any other, and never so an event may be plugged into an audio input; the
two lists that hold them (`outputs` and `events`) are separate for exactly that reason.

## A node's name is not its module's

`WebChainStep.uses` is the module this node USES, its `extends` ref as written. A node and the
module behind it are two different names, and a card drawing only the node's makes seventeen
nodes of one mixer read as seventeen unrelated things, with what a node IS learnable only by
opening it. So the header says the MODULE, with the node's own name on hover — see
`moduleDisplayName`.

It is absent on a node that IS a module (a `modules/…/module.yaml` names itself) and on a track,
which has no module at all. That absence is what the header reads as "one name here".

## Ports: what is sent, and when

`inputs` is sent only when a module has more than the one input every module has; absent means the
single flow input, which is every module drawn before ports existed. `mandatory` rides along
because it decides how many sockets show before anything is wired: a port that must be fed is
drawn from the start, an optional one appears as the free jack past the last occupied one. Absent
means mandatory, matching the module schema. See `packages/song/docs/ports.md`.

`outputs` is on the same terms, sent only when there is more than one. All of them are shown at
once: an output is offered rather than required, so there is nothing to reveal progressively.

`events` are drawn as labelled sockets down the right edge, under the signal outputs, and never
mixed with them — an event is not something the chain carries. Absent on a module that announces
none, which is most.

`WebOut.fromPort` says which OUTPUT an edge left from, when the chains file keyed one
(`sep#vocals: [ reverb ]`); absent on the single output most modules have. `WebChain.fromPort`
does the same one level up: a lane offers both audio and midi and is not typed by what it carries,
so two runs may start at one lane and this is what tells them apart, without anything having to be
looked up. See `packages/song/docs/trackModules.md`.

### `TRACK_OUTPUTS` order is load-bearing

Audio FIRST, and twice over: a cable that named no port is the first output (the compiler's
`isFed`, the renderer's `cablePath`), and audio is what a bare-wired lane overwhelmingly carries.
Orange then blue, left to right, on every lane in the graph.

### `#` is the third separator

`PORT_SEP` is `#` because the other two are taken and mean something else: `:` joins a module to
its node, `/` joins a namespace to a category to a name. A port is a third axis, so it needed a
third character rather than an overload of one of those — `@st0/audio/crossfade:live#b` has to
stay readable as three separate facts. Only the LAST `#` is the port, so every other separator in
the ref is left alone.

## The three "what may it choose from" pairs

`assets`/`assetChoices`, `base`/`bases` and `shader`/`shaders` are the same shape of answer three
times, and here for the same reason each time: what a folder holds is a fact only the disk side
can read, and a dropdown offering something the module does not carry would write a name that
resolves to nothing.

- **assets** are the files a module loads by param name, relative to its own `assets/`, and the
  choices are that folder walked. Per module and not per graph: the choices are that one folder's
  contents and nothing wider.
- **base** is the opaque `.vstpreset` under a module's params, chosen from its own `base/` folder
  plus every module it extends, nearest first. `bases` is absent on a module with none, which is
  most of them; that absence is what the builder and the graph read as "no base control here".
- **shader** is which GLSL pass a shader node runs, from its own `shaders/` folder plus everything
  it extends. `shaders` is absent on every module that is not one.

`WebWidget.library` is the historical spelling of a filepicker, from when the files came from a
shared library. It is still read as one, so panels already written keep working — see
`packages/song/docs/filePicker.md`.

`WebWidget.options[].arg` is what a module FIELD is SET to when that differs from what the entry
is called. A field is written by a command naming a state, and for most of them the state is the
word on screen ("auto"). An input's socket is the exception: it shows "Input 1 + 2" and has to
write `1,2`.

## What a module runs with

`params` are the defaults plus the overrides. A bound param may be ABSENT — the plugin's own
default is known only to the engine, so a widget with no value falls back to its authored min. A
STRING is a file-valued param (`model`), drawn as a dropdown over the module's `assets/` rather than
a knob; the engine never sees it as a param (see `nodeProject`'s `numericParams`).

`cc` comes from the `controller.yaml` in the module's FOLDER, so it is the module's and shared by
every node of it, exactly as the panel is. It is keyed by the widget's `bind` string verbatim
(`Cutoff`, `@monitor`), so a widget finds its own control by the one name it already has.

`alternatives` is sent only when there is a CHOICE — one entry is the module's own fields, which
is not a menu, and a node with nothing to pick from should grow no button. `params` and `ui` are
already the CHOSEN set; these say what could be chosen instead. See
`packages/song/docs/alternatives.md`.

`monitor` and `channel` are module FIELDS rather than params, which is why a widget bound to one
needs a target of its own (`widgetTarget`'s "module" kind). For `channel`, only the numeric form
travels: a `channel:` naming a preferences LABEL is the rig's own vocabulary and resolving it
belongs to whoever holds the preferences, so an unresolved label arrives as absent and the panel
shows no selection rather than a wrong one.

`tap` is where a node's waveform widget listens. Normally its own plugin's output; an io "in"
module has no plugin at all, so it borrows the INPUT side of the first plugin on the lane it feeds
— the same signal, one step downstream. Absent means the widget falls back to `pluginId` plus its
own `source`.

`missing` is not fatal: the step compiles to nothing and the graph draws the name with a `?`.
Bypass is the one thing it takes.

## A rack's pads

`rack` is the EFFECTIVE rack, `extends` already folded in, because that is what the module plays:
a kit extending a drumrack sounds its base's kick and its own snare, and a node showing only the
three lines of its own file would be showing something the project has not got.

Each `WebRackSound` carries what a pad needs to SOUND it as well as to label it — a samples rack
names its `clip`, a slice rack names the shared `source` and its window. Both are on one type
rather than a discriminated union because a pad asks the same question of either ("what do I
play?") and the answer is read once, by whoever auditions it. The authoring model is `Rack` in
`@studio/song`, which splits samples from slices; this is the flattened view a surface draws.

## Curves and automation

`WebCurve.points` is a `custom` curve's points verbatim — song timecodes and values in 0..1 —
absent for every other type, and that is the whole rule. An LFO is a shape you PARAMETERISE and an
ADSR is fired by note-ons, while a custom curve is a shape somebody DREW against song time, which
is the only one a timeline row can show and later let you move.

The definition rather than the bake: these are already absolute positions, so nothing has to be
sampled and no bake logic exists twice. Baking the LFO here instead would be 24 points per bar
(2048 at the ceiling) on a document the graph pane refetches on every reload, to draw a shape its
own card already names in two words.

`WebAutomation.trigger` is the module whose events restart the curve — what the event cable on the
graph IS. Only an envelope reads it; a curve of song time is fired by nothing. Absent means the
module this binding is on, which is the case nobody needs to say.

`WebAutomationLane` and `automationLanes` are the join, done once. It is derived from the graph
rather than carried on the project document because that is where the facts already are: the
binding lives on a module (`WebChainStep.automations`) and the shape on the curve
(`WebCurve.points`), and a track owns the lane only because the automated module sits in its
chain.

A run is named after the lane that starts it, so a chain with a `from` IS a track's chain and its
steps' bindings are that track's automation. A bus chain has no `from` and owns no lane here — its
automation belongs to a return track the timeline does not draw. It is computed here rather than
in the timeline because it is a fact about the GRAPH, and the graph pane is what fetches one; the
timeline receives the result, and deriving it twice is how the two surfaces would come to disagree
about what is automated.

## The graph's track side

`positions` is where somebody PINNED a node, `graph.yaml`'s `positions:` verbatim. The layout
places only what has no entry there — a node dragged once stays put for ever.

`trackAlternatives` has its own map for the reason `trackColors` and `trackClips` do: a lane's
node is built from the graph's track side rather than from a chain step, so what it draws has to
arrive there. That the two sides still exist at all is the seam to collapse next — a lane IS a
module node now, and this is the fourth channel saying so the long way round.

`frozen` is keyed by node name, a lane or a module, since a freeze cuts across both. `"at"` is the
point the render was taken at, `"inside"` a node the render already contains — two words rather
than a boolean because they mean opposite things about what a click does: the point can be
unfrozen, and everything inside it can only be reached by unfreezing that point. Absent when the
project has no freeze in force; a `frozen:` whose render is not on disk is not one. See
`packages/song/docs/freeze.md`.

`modules` carries the note text of doc modules only, so it is empty for almost every project. It
is optional because the layout-only subgraphs feeding dagre carry geometry, not notes. It was
`{docs, todos}` on every module, for a bottom panel that listed everybody's notes in one place; a
note is its own node now — a node of `@meta/doc`, wired from what it is about — so the text is
read where you are already looking. See `packages/song/docs/docModules.md`.

## `WebTrackClip`: a trim, deliberately

It is what the GRAPH needs and no more — enough to list a clip on the track's node. No `loop`,
because a node lists WHAT is on a lane and the timeline is where how-many-passes is read. `kind`
is here because "missing" is the one thing about a clip a routing diagram must say out loud: a
lane pointing at material that is not there looks identical to a full one otherwise.

`tc` is `start` as the song SPELLS it, `5:1:1`, bar:beat:tick, 1-based. It is formatted where the
numbers are — the file service, from the project's time signature — rather than sent as a
signature for the renderer to divide by: `beatsToPosition` is the one function that spells a
position in this app, and a second implementation in the browser would be a second answer to
"where is this clip", differing on exactly the songs that are not in 4/4.

`len` comes from the COMPILED project, which is the only thing that resolves a placement into an
extent: `loadGraph` reads track files without opening the clips they name, so the routing model
alone cannot answer it. Absent when the project does not compile — the graph is what you fix a
broken project from, so it must draw without this. A compiled `length` of 0 means "the source's
natural length", which nothing on this side knows either; the file service substitutes the same
stand-in the timeline draws for it.

## A panel's widgets are on every tab

`WebModuleUI.tabs` is the panel's pages, in order, beside the `widgets` every tab shows. Anything that
looks a control up by its bind goes through `panelWidgets` (`panel.ts`), which walks the shared map
and every tab's: a knob on a closed tab is still the module's, and a lookup over `widgets` alone would
answer "no widget" for it. The walk lives here rather than in a renderer because the file service,
the chains view and st0's MIDI control all need the same answer, and this is the one package all
three already import. `hasTabs` is the other half: a single tab is no tab, so the column is drawn
only for two or more.
