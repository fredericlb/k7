# graphDoc.ts — the plugin-state flags the Chains graph draws

A chain step carries three mutually-informing flags, so the graph can distinguish
"nothing here" from "something here that won't load".

## `stub`

A plugin slot with no plugin at all — typically a module that came in from an import
with nothing matched. NOT a rack, which legitimately carries a sampler instead of a
plugin.

**And not a module with no slot to begin with.** A `shaders`, `shapes` or `video_transitions`
module IS its behaviour — GLSL it carries, or params it draws from — so an empty `plugin:` on one
is not a hole, and `hostsPlugin` (`@studio/song-schema/moduleTypes`) is what says so. Without that
test every shader and every shape draws red, captioned "missing plugin", for having exactly what
its type folder says it should have. The same test gates `pluginId`, and must: these run in the
BROWSER, so an engine address for one would name a plugin no engine has.

## `notSupported` (amber)

The module HAS a plugin, and its `plugin.type` is the deliberate marker
`"not_supported"` — k7 knows about it and knows it can't load it.

## `unknownPlugin` (red)

The module HAS a plugin the engine can't load, for one of two reasons — both "unknown to
the engine":

- **an unknown `plugin.type`** — a typo, or a format the engine has no loader for;
- **a known EXTERNAL format whose plugin isn't in the scan cache**
  (`<state>/exts.json`) — e.g. a VST3 the project references but this machine hasn't
  scanned or installed. That's the common one on an imported song.

The KNOWN types are `internal`, `jsdsp`, `offline`, and the external formats. The list is kept by
hand, and a type missing from it fails in a way worth remembering: the module plays perfectly —
the compiler hands the engine its graph — while the node draws red and its knobs draw empty.
Empty because a red node gets no `pluginId`, and that is the address the panel asks the engine
for a parameter value by. So a missing entry costs both the colour and the values, and neither
says which list is wrong.

## `offline` is known AND has no pluginId — the one case where they come apart

Being known and having an address are two different facts, and `offline` is the type that
proves it. It is known for the same reason `jsdsp` is — the compiler recognises it, so
drawing it red would call a module that works exactly as written broken. But where `jsdsp`
becomes a real plugin in the compiled document, `offline` becomes **nothing**: the compiler
reads the type and skips the emit (`if (rawType === OFFLINE_TYPE) continue`). It means "no
engine plugin, realised outside the graph" — a pass that writes files for a stem splitter,
the player warping the clip it feeds for a deck's tempo.

So it gets no `pluginId`, and the reason is worth stating plainly: an id here would name an
address no document contains, and everything downstream believes it. A deck's tempo fader
classed as a plugin param sends `set-plugin-param` to `deckA:tempoA` for ever — no error, no
log, a fader that moves and changes nothing. The panel draws the same lie: a knob you can
turn, over a param that was never there. And the input tap two loops below, whose comment
promises an id "the engine really has", could land on one too.

Without the id the widget resolves to no target and goes inert — `pickWidget` returns on a
null target — which is the honest state. What such a module's panel shows is its DECLARED
params, since nothing live will ever arrive for them. Where the value actually lives is the
surface that realises it: for a deck that is the desk's fader, which addresses the TRACK.

## Why the two red cases behave differently downstream

An unknown FORMAT is unloadable anywhere, so `nodeProject` keeps it off the wire
entirely.

An UNSCANNED plugin is a per-MACHINE condition — the same project opens fine on the
machine that has it — so it still goes to the engine, which warns (`run 'k7 engine
scan'`) and skips it. The flag just says so up front, in the graph, instead of leaving
you to find out at playback.

Both carry no `ui` and no `pluginId`, and neither has a `hasNativePluginUI`: only a
plugin the engine can actually instantiate has a native editor window to open. That is
distinct from `ui`, which is the moduleUI widget grid k7 draws itself.

`faust` is known on the same grounds as `jsdsp`: a built-in host, handed the module's own source.
Whether that source COMPILES is the engine's answer and arrives as a warning — not something to guess
at here and paint the node red for.

## What each step is built from

Every module a step names is already RESOLVED by `buildGraph` — what it extends is folded in, so
every read is the module's own (`moduleResolve.ts` in `@studio/song`). What survives that fold is
`uses`, the authored `extends`, which says where the folded values came from; it is absent on a module
that names itself, which is the case the node header reads as "there is only one name here".

- **`missing`.** Everything else already reads `undefined` off an absent module; this flag is what lets
  the graph SAY so.
- **`inputs` / `outputs` only past one.** A single flow port is what every node already draws, and
  sending the list for all of them would put a field on every step to say what its absence already
  says. `mandatory` rides only when false, on the same terms: absent means mandatory on both sides, so
  the common port costs no field, and it is what decides whether a socket shows before it is fed.
- **`category` from the module itself, never its base** — a kind comes from where IT lives.
- **`events`** are read off the module's TYPE FOLDER, exactly as its icon is: an instrument is a thing
  that is played, so it has note-ons by being one. Nothing is authored, which is the point of testing
  with this one — the day a second event is worth having, this is where a module gets to declare its
  own.
- **`cc`** rides beside `ui` because it is keyed the same way, by the widget's `bind`, and read in the
  same place: the graph is where a knob is drawn, so it is where a knob learns its control.
- **`monitor` and `channel`** are a live input's own fields, not params: there is no plugin, so they are
  the module's. `channel` is NUMBERS only — a `channel:` may instead name a label from the machine's
  preferences, and resolving that needs the preferences, which this service has but the graph
  deliberately does not spend. A label is the rig's own naming, and rewriting it into numbers on the way
  to a panel would make the panel disagree with the file. Absent reads as "no selection to show", which
  is the honest answer.
- **`fromPort`**, on a run and on a lane's outputs, only when there is one: a module with the single
  output most have says nothing, and the wire stays plain for every chain drawn without one.

## The four choice lists

Four fields on a step are not what the module IS but what it could be SET to, and all four are read
from the module's own folder and its ancestors' — so a thin local module that extends a médiathèque amp
offers that amp's profiles.

`assetChoices` is per module rather than once for the graph, because there is no shared library:
the choices ARE the folder's contents. An unreadable folder is an empty one, never a failure.
`bases` is the same for `base/`, and `shaders` the same for a shader module's GLSL — that last one is
not asked at all unless the folder says `shaders`, so every other node is unchanged by it
(`packages/song-video/docs/shaders.md`). Nothing for a module the engine merely reports: it has no
folder anywhere. All three answer `undefined` rather than an empty array, which is what every surface
reads as "no control here".

`alternatives` is the fourth and comes off the compiled module: absent unless there is a choice, since
`graph.ts` only fills it past one (`packages/song/docs/alternatives.md`).

`rack` is the pads a rack module's node draws. It is built from `resolvedRack`, which is what the
COMPILER asks too, so the pads are the sounds the engine will really have — base module folded in and
per-symbol overrides applied. The two flavours flatten into one row shape: a samples symbol names its
own `clip`, a slice symbol names the rack's shared `source` and its window
(`packages/song/docs/racks.md`). Sorted by symbol, so a pad does not move because a YAML key was retyped
in another order, and absent when the rack has none — no pads rather than an empty row, so the node
keeps the size it had.

## The input tap

A live input carries no plugin, so there is nothing ON it to tap. The signal it sends arrives at the
INPUT of the first module on the lane it feeds — the same audio, one step downstream, and the only
place the engine can be asked for it without a new kind of tap. Being the lane's input it also carries
whatever clips the lane plays, which while overdubbing is what you wanted to see anyway.

It is a SECOND pass, over the built steps rather than the model: the id has to be one the engine really
has, and the only thing that knows which steps earned a `pluginId` is the loop that has just assigned
them. A lane that runs no plugins gets no tap — there is nothing to listen to.

## What the graph says about a lane

- **`trackSignals`** is what a lane puts on a wire when a run leaves it BARE, which is what it holds:
  midi if every event names a sequence, audio otherwise — including the mixed case, where the one cable
  really does carry both and audio is the colour a reader expects. A run that named a port carries its
  own answer instead. There is no `contentType` to read: a lane is not typed.
- **`trackClips`** is what each lane HOLDS, sorted by position, which is the order it plays in and the
  order a reader expects (`placements` is authored order, and a track file may perfectly well name a
  clip at bar 9 before one at bar 3). Only for a lane that really holds something: a group has members
  and a strudel lane streams, and both carry an empty `placements`, so an entry for either would be a
  promise of a list that is always empty. A placement is matched to its compiled extent by `start`,
  which is the one thing both sides compute the same way and what identifies a placement — a track may
  hold the same clip twice, at two positions. A width is absent when the project would not compile; the
  graph still draws, without them. `NATURAL_BEATS` is the width for a compiled `length` of 0, and it is
  the same number k7's timeline draws for the same case: neither side knows how long the audio really
  is, and two different guesses would put a clip at one width on the lane and another on the graph.
- **`trackAlternatives`** only past one: a list of one is not a choice, and a node with nothing to pick
  from should grow no menu.
- **`frozen`** asks `activeFreezePlans` the same question with the same two arguments the compiler asks
  it, which is what keeps the badge on the node and the silence in the engine from ever disagreeing.
  `"at"` is written last, so a point that is also inside a wider freeze still reads as the one the file
  says can be thawed (`packages/song/docs/freeze.md`).
- **`modules`** is a note's TEXT, keyed by DOC modules and nothing else — so its keys ARE the project's
  notes, which is what lets a surface find them without a second field saying "this one is a note". A
  note is its own node. `content ?? ""` rather than skipping an empty one: a note somebody has not
  written yet is still a note, and dropping it would make it vanish from the graph instead of drawing
  empty.

## Every curve, not only the bound ones

Carrying the bound ones alone leaves an unreferenced curve drawing nothing, which makes `curve new` a
verb whose result you cannot see. A curve is a node like everything else here, so one that drives
nothing yet is a card waiting to be wired, exactly as a module with no cable is. `usedCurves` is what
records each SHAPE, so a bound curve carries its label; the rest are added
beside it. Only a curve that EXISTS keeps its automation, and a drawn curve's points travel while a
parameterised one's do not — the points are what a timeline automation row is built from.

A broken curve file does not take the whole graph down: it reads as no curves at all.

## What `buildGraphDoc` is handed rather than compiles

`ClipExtents` comes in as an argument. `buildGraphDoc` is called on every graph poll and the workspace
already holds the compiled document memoised on the revision — compiling it again would double the cost
of a build this file has already been trimmed once for.

The `extends` vocabulary comes off the graph, which has already read it: calling `loadModuleRefs` again
here doubles the cost of every graph build (~1.8 s on a real project), and a graph is polled. The
`assets/` listings are memoised for the whole build for the same reason — ancestors repeat, so every
module inheriting one shared amp would otherwise re-read that amp's folder.

`EXTERNAL_PLUGIN_FORMATS` is imported, not restated: a second declaration here is a copy of the
loader's list, and one the loader's own note of copies to keep in step would not mention.
