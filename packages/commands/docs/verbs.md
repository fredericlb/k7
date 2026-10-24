# The verbs — why each one is shaped the way it is

`commands.ts` is the feature registry: one stable SID per capability, mapped to a handler that
acts through a `CommandHost`. The file states *what* each handler does; this page states *why*,
for the cases where the answer is longer than a line.

Read [refusal.md](refusal.md) for the `log` / `refuse` split, and
[optionalArgs.md](optionalArgs.md) for what `optional: true` means in `commands.yaml`.

## `CommandHost` — the four optional members

Four members of the interface are optional, and all four are optional for the same family of
reason: they need something the CLI does not have, and a host without them refuses the verb **by
name** rather than guessing.

| member | what it needs | what a host without it does |
|---|---|---|
| `getAudioDevices` | a live engine link, to enumerate the interface | `module populate` files the plugin modules and says the inputs were skipped |
| `setInputStereo` | an engine that will hear the grouping now | records the PREFERENCE and says the rig will hear it on the next connect — `engineLink` replays it on every one, so the act is already half done |
| `clipEnvelope` | the engine, which decodes and downsamples into the `.cache` sidecar | `event trim` refuses by name rather than guessing at a window |
| `runColdStep` | the stem separator — a 166 MB model | `clip process` refuses a chain that separates rather than bouncing it unseparated |

`runColdStep` is **handed in rather than imported** because the inference lives in
`@studio/file-service`, which depends on this package. `coldPass.ts` in `@studio/audio-passes`
declares the type; nothing here reaches for the implementation.

`stemsChain` — and `instrumentalChain` beside it, the same answer for the record without its voice
— are handed in for a different reason. The file is one import away and other `system`
verbs do read `<state>/preferences.yaml` directly — but a suite exercising "no chain named"
would otherwise pass or fail by whether whoever runs it has set one. The verbs that WRITE them
still write directly: that is their whole job.

`snapshot` backs up a file about to be overwritten, so undo can restore it. The web host wires it
to its edit journal; the CLI leaves it undefined and simply overwrites.

`EVENT_FIELDS` lists everything a placement may say beyond WHERE it goes — what `events add`
forwards to `PlacementSchema`, and so what a paste can reproduce. `ref` and `start` are handled
apart: every event has those two, and `start` is the one field a paste re-spells. Listed rather
than spread from the payload so a key nobody meant to accept cannot ride in. The schema is
`.strict()` and would refuse it anyway — but refusing a MISSPELLED field loudly is only useful if
the right ones are named somewhere a reader can find them.

## `library upgrade` asks the host for what it lacks

`fetchLibraryVersion` and `remoteLibraryVersions` are handed in for the reason `runColdStep` is:
the network and the hub are the file service's, and this package has neither. Without them the verb
still moves a pin between the versions this machine holds, and refuses one it lacks by name.
The pins file sits at the workspace root, outside every project folder, so no change token sees it
change: the verb calls `reload` itself, or the song would keep playing the old version.

## `module fork` writes a module that EXTENDS, not a copy

A copy would stop hearing the library: a fix published in the next version would never reach a
module that only looks like it. A fork that extends inherits every value it does not set, so the
one thing it holds is what the person changed, and `library upgrade` can name it when its base moved.
The panel IS copied, because a panel is a file of the module's folder and the fork is a new folder.

## `renders/` — where a freeze lands

One folder for the lot, at the project root. NOT beside the module's own file: a node's folder is
`nodes/`, shared by every node in the song, and a module from a catalogue has a folder shared by
every song. A render belongs to THIS project, so it lives where the project can see all of them at
once.

## Timecodes as keys

The project's `markers` map is keyed by timecode. A k7x key that is not a bare name is written
quoted, so `writeMarkers` replaces the map with `applyIn` and needs no writer of its own.

## Position vs. duration

Several verbs take both, and nothing downstream can tell them apart — both spellings are legal
timecodes, so getting the pair the wrong way round writes a fade several bars long and reports
success.

- `event fadein|fadeout <track> <timecode> <length>` — `parsePosition` for the first (inside
  `resolveEvent`), `parseDuration` for the second. A length of 0 REMOVES the fade rather than
  writing a zero.
- `project add|remove <at> <length>` — `at` is a position, `length` a duration. The caret
  pre-answers `at` (k7's `commandFill`'s `CARET_ANSWERS`), so from the timeline this reads
  "insert two bars here"; from the CLI it is a whole line, which is what keeps it usable from
  both. What moves is everything positioned in song time and nothing else — see
  `packages/song/docs/insertTime.md` for the inventory and for the rule about a straddling
  event, decided by its START like every other range operation here.

`event window <track> <at> <from> <to>` is the deliberate exception: `from`/`to` are in SECONDS of
the file where every other argument in the family is musical. The pair addresses a FILE — a
waveform is a file, and a hand pointing at it points at a second of it — and the field accepts both
spellings, so a hand-written musical window is only converted if somebody drags it. `<at>` beside
them is the ordinary timecode. An edge that restates the material's own is cleared rather than
written, the same rule the fades follow.

`event gain <track> <at> <dB>` is an audio event's own trim, −6 to +6, refused on a MIDI event
(`packages/song-edit/docs/eventGain.md`).

`event loop points <track> <at> <from> <to>` takes the MATERIAL's unit instead — beats into a
sequence, seconds into an audio file — because it is the clip panels' brace that sends it, and each
panel's ruler is drawn in its material's unit. One verb for both kinds rather than two, since the
event names its material and the material names the unit. `event loop` beside it is the switch:
on, off or toggle (`packages/song-edit/docs/eventLoop.md`).

## One implementation, two commands

Three families are one function taking the word it writes, because the only thing that differs is
what the noun promises:

- `track process` / `clip process` — what the first argument may name. `event process` runs the
  same bounce on one placement, after giving it its own copy of a clip other events share
  (`verbs/eventProcess.ts`).
- `event status mute|warp` — which aspect of the event moves.
- `event fadein` / `event fadeout` — which end of the clip the fade is on.

That difference is worth a command each: the word after the verb is the promise, and it leaves
room for a third without renaming anything.

### `event status` and the polarity trap

**`on` means the NAMED STATE is on**, in both: `event status mute on` silences the event, and
`event status warp on` makes it FOLLOW the clip's map. One rule, no exception to remember.

The two aspects have opposite sense — `mute` is a negative to switch on, `warp` a positive — so
each writer takes the state under its own name. A `!` on the call to `setTrackPlacementWarp` is
all it takes for `warp on` to mean UNwarped again.

The FILE keeps the negative spelling (`warp: false` on the placement), because that is what an
absent field has to mean there — an event warps because its CLIP does. Turning it is the handler's
job and happens once, where `now` is read. The two flags have opposite polarity in the file
(`disabled: true` is written, `warp: false` is) because their defaults are opposite, and both
writers delete rather than write the default — which is why the aspect selects the writer instead
of the two sharing one.

## `sequence note repeat|skip` — a pad's two effects

ONE implementation for both, taking the word it writes, because they are the same act on the same
note: two handlers would be two places to keep the addressing, the `off` spelling and the refusals
identical, and the second one would drift. A factory rather than a SID lookup inside, since a
`SidHandler` is only ever handed its arguments and its host.

`off` rather than `0` or `1`: those are values, and the file has no way to say them. A pad that
plays once on every pass is a pad with neither key, so turning an effect off is a DELETION — the
same rule the velocity drag follows going back to full. See `packages/song/docs/padEffects.md`.

## `track group` takes the tracks first, and moves them

`track group <tracks> [name]` writes a group lane where a lane's file goes. In a chain project that
is `tracks/` plus a one-step chain, since a lane is loaded only when a chain names it
(`packages/song/src/groupLanes.ts`). The tracks come FIRST so the timeline's right-click can fill
them from the lanes shift-clicked and run the verb at once. The name comes second and defaults to
`group-N`. A track already in a group is taken out of that group's `tracks:`, because membership
is written only on the group and a track in two lists is the "in two groups" warning. The group joins
no `trackOrder`: it is drawn above its first member.

## `track new` has no kind

A lane is not typed by what it carries: one lane holds events naming clips and events naming
sequences alike (`packages/song/docs/trackModules.md`). Seeding the empty sequence a lane plays is
`sequence new`'s, a separate act.

## `track mute` — a lane's mute IS its module's bypass

One state, in the one place a bypass is written (`packages/song/docs/trackModules.md`). A group is
a lane too — one that carries no signal — and both are silenced the same way, by name, in
`graph.k7x`'s `bypassed:`. Solo is not a set of mutes but project state (`soloed:` in
`project.k7x`). The doc is mutated and pushed rather than reloaded, so a mixer move stays snappy.

## `track duplicate` copies the chain, never shares it

A duplicated lane gets its own effect nodes for the run it owns, so editing one lane's effect never
touches the other's. The two commands differ only in events: `track duplicate` copies the lane's
playing placements, `track duplicate empty` writes `events: []`. A node with more than one feeder is
a meeting point and stays shared — it is a bus, not part of one lane's chain.

## `track rename` takes the whole name

A lane's name IS its filename, `[position.][prefix.]label` (`packages/song/docs/trackKind.md`), so
the new name is typed whole: `track rename ge.lead vo.lead` changes the instrument as well as the
file. Everything that names the lane follows — `graph.k7x`'s keys and arrows (a `#port` kept),
`bypassed`, the boxes, `project.k7x`'s `trackOrder` and `soloed`, a chain project's lane item — and
so does its strip when it still bears the `mix-<lane>` name `track new` gave it. A strip somebody
named is left alone, and so are the lane's effect nodes: their names were a convenience, not a
reference. A lane a surface mapping names is refused, since nothing writes a mapping back.

## `node stack` makes a subchain, so only a chain project has it

`node stack <node> <new>` is the per-track row's BRANCH button, on a seam. It takes a node `node new` just made —
loose, wired to nothing — and puts it right under `<node>`, the two in a subchain run in `<node>`'s
place; under a node already in such a subchain, the new one joins it. A lane is a source and nothing
goes under it, and a node in a side-by-side step has no single place to stand under. A `graph.k7x`
project is refused: the grouping IS a subchain, and a splice there would be `node insert`.

## `track hide` sets a lane aside, files and all

`track hide <track>` marks the lane's chain `hidden: true`: nothing draws, compiles or plays it, and
nothing is deleted. It is a chain project's verb, since the flag lives on a chain file. `track unhide`
is typed rather than offered on a menu — a hidden lane is on no screen to right-click.

## `event comp` and `event take …` — an event's takes

`event comp <track> <at> <take> <from> <to>` plays one take over a span, in SONG positions — not
`event window`'s seconds into a file. The event is found in the LANE FILE by where it starts, not
among the compiled clips: once comped, its first clip may be a take starting elsewhere. `event take
arm` is session state the file service keeps, like an arm; `event take midi` is the browser filing a
MIDI pass. The format and the recording path are `packages/song/docs/takes.md`.

## `event crossfade` makes an overlap, not a key

`event crossfade <track> <atA> <atB> <length>` overlaps two neighbouring audio events out of material
neither plays yet (B earlier first, then A later, `planCrossfade`) and fades each over the overlap;
the compiler recognises the shape. `event comp fade` is the same thing at a seam of a comp, written
under the event's `crossfades:`. Both take a DURATION, `0` removing the fades.

## `track input` puts the input IN the lane's chain

`track input <track> audio|midi` is what the per-track view's two buttons run. The step it writes is a USE of the
built-in input — `extends: "@meta/IN"` (with `monitor: "auto"`) or `extends: "@meta/MIDI"` — the form
a hand-written rig takes, so its card is named by it rather than by where it sits. In a chain project the
input is a step of the lane's OWN chain, just ahead of the lane, which is how a hand-written rig
reads (`IN`, then the lane, then its plugins). `graph chain connect` would get there too, but by
splitting the lane's chain in two and renaming its file, which nobody asked for. A `graph.k7x`
project has no chain to put a step in, so there it is a node and a cable. A lane something already
feeds is refused (`runCarriesInput`), the input being the one thing a lane takes.

## `node param` on a Faust node takes a FILE for a string

A Faust program's knobs are all numbers, so on a node that compiles to the Faust host a value that
is not one names the sound file of the program's `soundfile` slot of that name
(`packages/song/docs/faustFiles.md`). A library ref is checked against the `wavetables/` and
`samples/` the panel's picker offers, the way `setFileParam` checks an `ir`; `none` clears it.

## `task …` — the workspace's TODOS.md, addressed by number

The four task verbs write `TODOS.md` at the WORKSPACE root (`h.repoDir`), never the song's folder,
and refuse with no workspace rather than fall back — the playlist verbs' rule, for the same reason:
the list belongs to the workspace. A task is named by its number in the list, as the panel and a
reader see it, and `task mark` stores the project beside the timecode, one file serving every song
(`verbs/tasks.ts`; the format is `apps/k7/frontend/docs/tasks.md`'s).

## `track transcribe` — whisper writes the lane's text

The verb is the transcription plugin's (`packages/k7-plugins/src/transcription`) — this section
says what it does, not who ships it; the plugin folder is where its machine lives.

`track transcribe <track_in> <track_out>` listens to the video the PICTURE lane `<track_in>` places
and writes what is said as `<track_out>`'s **`content:`** — the field a lane's note is read from
(`packages/song/docs/docModules.md`), so the transcript is on the graph rather than in a panel
nobody opens. The text is **valid SRT, timed in the SOURCE video's own seconds**, because that is
the only clock the recording has: a lane cutting between sources would need the segments re-timed
onto the timeline to mean anything, which is a decision for the day somebody asks for it. The first
shot decides what is listened to.

The machine needs a whisper CLI — `whisper` (openai-whisper) or `whisper-cli` (whisper.cpp, which
additionally wants `STUDIO_WHISPER_MODEL` to name a ggml model) — and ffmpeg for the audio, which a
machine that renders has. A missing binary is said as the install it wants; one that RAN and failed
is quoted as it failed, because retrying with the other dialect would double a model download
nobody asked for. `<track_out>` is created when new and its `content:` REPLACED when not — a rerun
after a failed take updates rather than refuses — and every line is written only after whisper has
answered, so a refused transcription costs no track.

## `node tap` writes the NODE, never the module

A rack's kit is its node's (`packages/song/docs/racks.md`), so the six `node tap` verbs — `note`,
`sample`, `add`, `insert`, `rename`, `remove` — edit `nodes/<name>.k7x` (or the alternative that is
on), and a node that is not a rack is refused. `sample` takes a library file only, checked against
the same list its `samples` completion offers, and `none` clears it. `add` picks the next free `T<n>`
and the note after the kit's highest, since a new tap with a clashing note would fire twice.

`insert … before|after <tap>` is the positioned add a pad's menu offers: the NEAREST free note on
that side of the tap's. It never renumbers the kit to make room, because a note is what a sequence
plays — shifting three pads up one would silently change what the song sounds like. So on a kit
whose notes are contiguous, "before SN" lands below the lowest of them, not between two pads.

`out <node> <tap> <subchain|none>` sends one tap to a subchain of the node's chain file, on an
output of its own, and is the one tap verb that also takes an SFZ kit's pad. It checks the
subchain before writing, so a route to nowhere is refused here rather than at the next compile
(`packages/song/docs/racks.md`, "A tap with a chain of its own").

`chain add|move|remove` edit that subchain from the tap, writing the chain file directly rather than
through a graph rewrite: the first `add` makes the subchain and routes the tap, and the `remove` of the
last module takes both away, since an empty tap-fed subchain is one the next graph edit drops. A module
is named by its ref; a node by its id, which is what the popin sends (`packages/song-edit/src/tapChain.ts`).

`rename` changes the symbol in place, keeping its note, its sample and its line in the file. Nothing
else names a symbol but the node's own `rack:` and a hand-made panel's `@rack:<symbol>` bind, which
is the module's and is not rewritten. `rename` and `remove` refuse a tap the node only inherits:
touching it would mean writing the module, which is exactly what these do not. Each verb ends in a
reload — a rack's sounds are built when its plugin is.

Their arguments may be QUOTED, a sample's path holding spaces; the tap card quotes all three.

## `node alternative` reads the FILE

The names are read off the module's own file rather than off the compiled doc: an alternative may
change any field, so the doc carries the chosen one collapsed in and has nothing left to say about
the others. See `packages/song/docs/alternatives.md`.

`select` is patched rather than reloaded when it CAN be: when the set that was on and the set
asked for state nothing but numeric `params`, the switch is sent as values over the held doc
(`moduleValues.ts`) and the engine takes them as a diff. That is the A/B case the badges are for,
and a reload there recompiles the whole project to move two knobs.

What to set is read off the module's FILE alone (`paramsSwitch`): the new set's values, and for a
param only the old set stated, the value the module's own fields give it. Loading every module to
resolve the one would cost most of what the reload costs — the module maps are rebuilt after any
write, and they are the bulk of a compile. Only a param the old set stated and the module's own
fields do not goes through `resolveModule`, since its value is whatever the module extends.

Anything else reloads — a plugin, a panel, a clip list, a file-valued param — and so does a switch
that leaves a param stated nowhere at all: a diff keeps such a param where it was, a rebuild puts
it back to the plugin's default, and the two must not sound different.

## `module new` writes a module and stops

`makeModule` handles two cases: a name with no local folder yet (create one, extending the ref when
one is given), and a module this project already has (leave it alone, do not recreate it). Already
there AND told to inherit something else is a real
disagreement rather than redundancy: a module cannot be re-parented by asking for it again, so
acting would ignore what was typed.

It does NOT make a node. What a chain names is a node, and creating one is `node new`'s — which
also puts it in the graph, since a node with no entry there is drawn nowhere. Bundling the two here
would make "create a module" and "start using it" one act nobody could have separately.

## `track automation add|remove` — a VIEW onto `node automate`

Not a second place to store a binding. A binding lives on the MODULE (`automations: [{param,
curve}]`, keyed by param — one knob, one curve), and a track owns one only because the automated
module sits in its chain: `ownerOf` in the compiler returns the chain's own name, which is the
lane's. So the handler resolves the param against the track's chain and writes through the very
writer `node automate` uses. Two verbs, one source of truth.

It is worth a verb of its own because a lane on the timeline is reached from the LANE, and asking
someone to know which module in their chain owns "Filter Freq" before they can draw a curve
against it is asking them to hold the graph in their head to edit the arrangement.

Two knobs of one name on one chain is a real shape — two mixers, two filters — and there is no
defensible way to pick, so the handler names them and sends you to `node automate`.

The `add` half creates a flat curve where the knob already sits. A curve overrides its param the
moment it is bound, so a flat curve at the wrong height is an audible jump on a verb whose promise
is to change nothing yet — hence the refusal when the current value cannot be read. The line spans
to the song's end so you can grab it at both ends; a song with no material yet gets one bar rather
than a curve of zero width.

`remove` leaves the curve FILE. An unbind is not a deletion, and an unbound curve still draws as
its own card on the graph — so nothing is orphaned invisibly, and rebinding is one verb.

## `curve set` writes a curve whole

`curve set <name> <json>` is the curve editor's Save (`ui curve`): the JSON is the file's own fields,
validated against the schema, and the file is created or replaced with exactly them — one command, so
one save is one undo. The partial edits stay `curve point add|move|remove`; this is for the editor,
which holds every field anyway. See `packages/song/docs/curves.md`.

## `curve point add|move|remove`

What makes the timeline's automation row touchable. Without them a `custom` curve can only be
created flat (`track automation add`) and shifted wholesale (`project add`), its individual points
typed into the file by hand — a row drawing a picture nobody can grab.

Addressed by TIME, because a curve is a function of song time: two points cannot share a moment,
so the moment is a usable name for one. The same "one address, one value" rule that makes `param`
a usable address for a binding.

`value` is 0..1 — the CURVE's range, not the param's. What it maps onto is the plugin's business
(`polarity` decides the output range and the engine maps it onto the knob), and one curve may be
bound to more than one thing over its life.

The LAST point is not removable: `parseCurve` refuses a pointless curve by name, and a curve file
the loader cannot read takes the whole project down with it. Taking the automation away is `track
automation remove`, which unbinds and leaves the curve, rather than emptying a file until it stops
parsing.

## `runCarriesInput` — does the signal ARRIVING at a node come off a live input?

The one question that decides whether a cable may land on a lane: a track's material is its clips,
and the single exception the model makes is a live input's signal, which is what recording onto a
lane IS — an audio input's sound, or a MIDI device's notes (`packages/song/docs/midiIn.md`). `packages/song`'s `graph.ts` asks the same thing of the chain whose `out` names the track,
and warns when the answer is no.

UPSTREAM, not "somewhere in this node's chain". A preamp reaches a compressor through the mic
chain's `out`, and the compressor is the first step of a chain of its OWN — so reading `use` alone
answers no for `mic → comp`, which is the shape of every recording path with a plugin on it.
Walking the feeds is the only reading that survives the derivation splitting a run in two.

## The spawn pin

An optional trailing `<x>,<y>` says where the cursor was when the web asked, so a created node is
BORN there instead of asking the layout. Pulled off the argument list before any other parsing:
the comma makes it unmistakable for a ref or a node name, which is the whole reason for the
spelling. Negative like any pin — the canvas above the first track is canvas, and a node asked for
there is born there. See `graph move`.

## `node param @<field>` — a module's intrinsics

Its own fields, in a table rather than a verb apiece, because from the outside they are one act:
set this control on this module. The `@` is the whole of the
difference from a plugin param — a param is sent to a running plugin, a field is written into the
file and read when the module is BUILT.

That is also what makes them reachable from a widget: a `bind: "@channel"` in a module's `ui.k7x`
needs no command of its own, and the day a fourth field is bindable it needs no verb either — one
line in the table. See `packages/song/docs/intrinsics.md`.

Each entry takes the value as TYPED and answers with what to say about it, or throws the sentence
that says why it cannot.

An `@field` is one word, so its value is the whole REST of the line, spaces included:
`node param keys @device Arturia KeyStep 37`. A plugin param is the opposite: its NAME may hold
spaces, so there the value is the last word. A device or a lens is named by its label, and labels
have spaces; reading one like a plugin param would turn the name into a field nobody has.

- **`channel`** — one channel or two, and two only ever means a pair the interface actually
  groups. `findWaveInput` matches a device on its exact channel list, so a set the rig does not
  offer resolves to nothing and plays as silence. Nothing here can check that (the rig is the
  engine's to know); the graph's IN panel only ever offers sets that exist, and the entry refuses
  the shapes that could never be one.
- **`base`** — which named base this module starts from, the opaque `.vstpreset` under its params.
  `none` clears it, spelt like the file-valued params' own clear: a dropdown needs an entry meaning
  "back to the default", and a surface should not have to send an empty argument to say so. NOT
  checked against the folder, deliberately — which bases exist is a fact about a disk this may not
  be on, the surfaces that offer the choice offer only what the loader listed (`moduleBaseChoices`),
  and a base that has gone missing is already handled where it matters: `presetFor` falls back to
  the module's default rather than loading nothing. Refusing here would mean a name could not be
  typed before the file it names is synced.
- **`shader`** — which shader a shader node runs, a folder under the module's `shaders/`. `none`
  clears it for the reason `base`'s does, and a shader node with none passes its picture through.
  Not checked against the disk, same reason.

Writing one is reloaded rather than patched into the running engine: a field is read when the
module is built, so the engine learns it by rebuilding the track's input. The file may be the
workspace's SHARED one — `module populate` files one io/IN node per interface channel there,
beside the `channel:` that says which channel it is — so the reach of the write is said out loud.
Nothing else here writes past the project on a click.

## File-valued params

`model` and `onnx` (`moduleTypes`' `FILE_PARAMS`) are params like any other — they land where a knob
would, in the `params:` of the attribute set that is on, under `engines.<name>` when the module runs
an engine (`../../song/docs/engines.md`) — but their value is a filename, so two things differ. It is checked against the
assets the module actually carries, and it is NOT patched into the running engine: a plugin loads
its file when it is BUILT, so the handler writes and reloads. Swapping an amp model is not a knob
drag.

ONE branch answers both, and the next one costs nothing. A verb per param cannot: the asset picker
sends `${param} …` for whichever param it was opened on, so the param that has no verb of its own
reaches a command that does not exist.

The check runs over the module's own assets AND its ancestors', which is the same answer the
panel's picker offers — so the command cannot refuse a file the picker just showed. It could: a
song points at a shared amp with a thin local module that extends it, and only the shared folder
holds the files.

## `node param` on the four built-in outputs

`OUT` carries exactly one param, `Volume`, and it is the song's output level: the graph reads
`MIX -> [chain] -> OUT`, so the last thing the signal meets before the interface is this gain. The
header's fader and its Fix button both send this line. It is the ONLY one of the four with a param
on it.

`OUT` is a built-in NAME rather than a module on disk (`moduleTypes.ts`), so its param has no
`module.k7x` to land in and lands in `project.k7x` instead. That is a storage detail and not a
second control, which is why `project master` is the same write under another name. UNITY IS NOT
WRITTEN: 0 dB deletes the key rather than writing a zero — the rule `type:` and a module's
`status:` already follow. It is patched into the running engine rather than reloaded, like every
other `node param`: the diff answers `MasterVolumeChanged` and sets the gain in place, so moving
the fader does not stop the song. See `packages/song/docs/masterVolume.md`.

The other three are refused BY NAME rather than left to the generic message, because each is what
somebody will type. `MIX` because a sum is a place the signal passes through and a level belongs to
what leaves. `RENDER` and `VIDEO_OUT` because they look like `MIX` and `OUT` and the symmetry stops
exactly here: a frame has no level, so the picture's pair is pure routing
(`packages/song/docs/videoOutputs.md`).

## `track new` writes the file first

A track IS its file: `track.new` and `sequence.new` write it, then reload, so what plays is what is
on disk. Handing a doc built in memory to `applyProject` instead caches it and tells the engine
without writing anything — a strip appears in the mixer and the track vanishes on the next reload.

## `event trim`

Cuts the silence off both ends of ONE event by moving that event's WINDOW (`from`/`to` on the
placement). It does not touch the audio. A take's head is the tail of a count-in and the player
settling; its foot is a room and a hand leaving a string. Both are things you stop PLAYING, not
things you want destroyed — and a window is one line to put back, where a rewritten wav is a
restore from the undo journal.

The gate is in dBFS and defaults to −40: below a room's floor on any usable take, above true
digital silence. Where it lands is `trimWindow`'s decision and is tested there — BOUNDED to the
window the event already plays, so a re-trim refines it and never reaches back into material an
earlier trim removed (undo is how that comes back, deliberately). A gate that reached outside what
the panel shows lit would cut on evidence nobody could see.

There is no clip window — a clip file describes the bytes, a placement describes the use
(`packages/song/docs/materialCut.md`) — so the verb names the EVENT it acts on, and trimming one
placement leaves the others alone by construction rather than by a warning in the help.

## `clip warp`

One verb places and moves, because from the waveform they are one gesture: you drag a mark to a
beat, and whether one was already there is not something you decide beforehand.

A clip with no map gets its two anchors seeded from its own length. Seeding alone changes no sound
— an identity two-point warp is skipped by the engine — so the FIRST call on an unwarped clip
writes a map and a point in one go, which is what makes the gesture whole.

## Solo is PROJECT STATE

`soloed:` at `project.k7x`'s root lists the soloed lanes — several at once — and the ENGINE
resolves it across the mixer (any soloed track silences every non-soloed one; `applySoloMute`). The
compiler folds a group's entry onto its members.

ONE list rather than a derivation: bypassing every other lane would rewrite N files to say one
fact, could not hold two solos at once, and would read in `graph.k7x` as a wall of mutes nobody
wrote. Turning the last solo off deletes the key — absent means what it always means here, the
default.

Soloing a MUTED lane lifts its mute: asking to hear a lane is one act. The doc is mutated and
pushed rather than reloaded, so the mixer stays snappy, with the same fold the compiler applies.

## A lane's level, its alternatives and its freeze are `node` verbs

A track states no level of its own: the value goes to the MIXER MODULE at the end of its chain, so
its level and its pan are `node param <mixer node> Volume|Pan`, like every other param on that same
module. Addressing them by the lane's name would be one module's params under the wrong noun.

`node alternative *` and `node freeze` reach a lane and a reverb alike, because a lane IS a module.
See `packages/song/docs/trackModules.md`.

There is no `track normalize` / `clip normalize` either: normalising is a treatment, and a
treatment is a chain — `track process` / `clip process` apply one.

## `event move` between lanes

A destination track makes it a move BETWEEN lanes, refused only when the destination has nowhere to
put THIS event. A lane is not typed, so the question is about the EVENT: a lane takes a note when
its midi output is wired and a clip when its audio one is, and the wire says which in one word
(`packages/song/docs/trackModules.md`). Comparing the two lanes' kinds instead would refuse every
move between an audio lane and a sequences one.

## `timeline …` — the project's other timelines

`timeline new`, `timeline length`, `timeline lane new|remove` write `timelines/<id>.k7x`; its EVENTS
are the `event` verbs', on the lane address `<timeline>><lane>`, which `trackOf` resolves as it
resolves a song lane. Placing a timeline is `event add`, since it is placed like a clip. A timeline
event is found by its own start (`eventAt`), and only `event gain`, `event status mute`, move,
remove and paste take it: every other `event` verb would give it an extent of its own, and its
length is fixed (`packages/song/docs/timelines.md`). A write that would put a timeline inside
itself is refused before it lands, since the project would no longer load.
`timeline play` sets the session's audition through the optional `CommandHost.timelinePlay`: a host
with no engine refuses it, and nothing is written (`packages/song/docs/timelines.md`).
`selection timeline` makes one from a rectangle: the events of ONE lane STARTING in `[from, to]`
move into a new timeline as long as the range, and one event of it takes their place at `from`.
One lane, because a timeline plays through the lane it sits on, so events of several lanes would
come out of one instrument. The timeline file is written before the lane and removed if the lane's
write fails, so the events are never in both places nor in neither.
`timeline lane copy <lane> <timeline|main> [name]` copies a lane's EVENTS onto a new lane there,
named after the copied one (`-2`, `-3`… when taken). `main` — the song's own timeline, `Main` on
screen — is a reserved destination, which is why no timeline may be named `main`; a copy into it
gets `track new`'s file and strip and no chain. Main to Main is refused for `track duplicate`, which
copies the chain too. A PICTURE lane — the song's, or a timeline's `<timeline>><lane>` — is copied
by the same verb (`timelinePictureCopy.ts`): its shots, in seconds as written, onto a timeline's
`pictures:` or into a new picture lane of the song (`createPictureLaneFile`). Main to Main is allowed there and keeps the frame,
picture having no duplicate verb of its own. The `picture` verbs take `<timeline>><lane>` wherever
they take a lane, by resolving it to the timeline's file and the lane's map inside it (`laneFile`);
`mute`, `solo`, `rect` and `sound` refuse it (`layerFile`), being about the song lane it draws on.
`timeline rename` repoints every placement of the timeline, in every lane
file and every other timeline, before it renames the file, so no event is left naming nothing.

## `events move` is one command, not a loop

The bulk form of `event move`: every placement STARTING in `[from, to]` (both inclusive), on each
named lane, moved by the signed duration `by` (`+1:0` is a bar right in 4/4, `-0:1` a beat left).
The delta is a DURATION wearing a sign, so `+1:0` means one bar whatever the bar is.

One command on purpose rather than a loop of `event move` lines: the whole gesture is then one undo
step and one reload — and the addresses are collected before any write, where a loop's later lines
would address a project its earlier lines already changed. `all` is every lane that can hold a
placement; naming a generated lane is refused, because refusing what was asked for beats silently
doing less than asked.

## `event split`

The KIND decides what it writes. A sequence is divided note by note into two MATERIALS, a placement
pointing at each (`@studio/song-edit`'s `materialCut`), so each half is notes to edit at once. Audio
is split VIRTUALLY: the same file placed twice, the head's window ending at the cut and the tail's
starting there, with nothing rendered and no engine needed — a cut is the first edit anyone makes,
and it must be instant and work offline. A half that has to be processed apart is given a material
of its own by `selection consolidate` (`packages/song/docs/materialCut.md`).

A looped audio event is refused, as before: its window repeats, and a cut inside a repeat has no
single place in the source.

A sequence split leaves the material it cut on disk: another placement on another lane may still be
playing it, and nothing here can know what was meant to be kept.

## `selection consolidate`

Put a range back together, whatever is in it — a split rejoined, two materials merged, a stack
flattened, all by one act. It WRITES in every case, rather than holding out for the one arrangement
where rewriting placements alone would do.

ONE lane, and `tracks` is plural deliberately: the timeline's rectangle can span several, so the
refusal has to be sayable here rather than in whatever built the line. A consolidation across two
lanes has no obvious answer — one file, or one per lane — so it is refused rather than guessed.

GAPS SURVIVE. The new material spans the whole range and silence where nothing played is part of
it, which is what makes the result play back identically — the same test a split has.

## `event add` and `events add`

`event add <track> <clip> <timecode>` is the one ADDITIVE verb of the event family, named for what
it makes: the clip already exists and is not touched, a placement is a REFERENCE to it, and the
same material may sit on several tracks at once. Which is also why nothing checks whether it is
placed elsewhere already. The clip is NAMED rather than addressed by position — there is no event
yet to address — and it is checked against the project's own list, because a placement naming a
clip the compiler cannot resolve fails the whole song. Refusing the edit beats writing a file that
no longer loads.

`events add <JSON […]>` is the batch form and the receiving half of a paste (`sequence note add` is
its counterpart for notes). Everything is CHECKED before anything is written, and that ordering is
the point: a paste is one gesture, so it lands whole or not at all. A loop of `event add` lines
would be one journal entry each — twelve Ctrl+Z to undo one paste — and a bad entry halfway would
leave the earlier ones placed with nothing on screen saying which. Grouped by lane so each file is
rewritten ONCE (`addTrackPlacements`), whatever the rectangle spanned.

It takes the WHOLE placement vocabulary, not just where the event goes: a paste carrying only `ref`
and `start` puts down an untrimmed, unfaded, single pass of the material wherever the copied event
was trimmed, faded, silenced or repeated. The extra fields are validated against
`PlacementSchema` rather than field by field — that schema is `.strict()`, so a key this verb has
no business writing is refused by name instead of landing in the file, and the window's `to > from`
rule is enforced in the one place it is stated.

## `graph pin`

The other half of `graph move`, and the reason the picture stops rearranging itself: a node the
LAYOUT placed is unpinned, so the next fresh layout is free to put it somewhere else, and it will
whenever anything about the graph changed. Unrecorded, that makes the track row seem to shuffle at
random — the change surfaces at a reload, long after the edit that caused it.

So the drawing writes its own answer down, once, and after that the FILE is the layout. dagre
speaks again only when `graph organize` empties `positions:`.

A batch and a single write, and NOT an undo step: k7 sends it with `journal: "skip"`
(`packages/file-service/docs/history.md`), because nobody did it. Journalled, it is the first thing
Ctrl+Z on a freshly opened project takes back — a pin the person never made, undone in place of the
edit they meant. It never overwrites an existing pin (see
`setNodePositions`), so it cannot walk over a card somebody dragged, whatever the browser thinks it
drew.

## The note edits

Every one is addressed by KEY and by where the note starts NOW: a pitch and a place are what a roll
can point at, and a note has no id of its own.

- **`sequence note velocity`** — 0..1, the units the file states (`NoteSchema`'s `v`), clamped
  rather than refused: the drag hands over a pixel position, and a gesture that ran past the top of
  a note means "full". A velocity of 1 CLEARS the field instead of writing the schema's own default
  into a file that never mentioned it — the same rule `alternative:` follows going back to the
  first set. Rounded to two decimals, because a file full of `0.7333333333` is noise in a diff.
- **`sequence note timerange`** — one verb for two gestures, because on the roll they are one
  gesture with two grips: the body moves the note, an edge stretches it. Two verbs would be two
  answers to "which note is this", and they would eventually disagree. The file states a LENGTH, so
  the subtraction happens in the handler: the caller says where the note should END, which is what
  it dragged, and nothing downstream has to work out whether the end moved because the note grew or
  because it slid.
- **`sequence note split`** — the roll's counterpart of `event split`, and the same shape of act:
  the note keeps its head and a second note carries the rest, so what sounds is one attack where
  there was one and two where there are now two. Its VELOCITY rides onto both halves — what a note
  is worth is a property of the sound, and cutting it does not make the tail quieter. Refused on
  either edge, where one half would have no length.

## `renameForNewModule`

Follows a node's name onto the module it now extends. Null when there was nothing to do — a name a
person chose, or a module whose leaf did not change. A STRING when something happened, including
the two refusals worth reporting: a name a surface points at, and a destination already taken. Both
leave the replacement standing, which is the right trade — the node plays the new module either
way, and only its label is stale.

## `node bypass` — graph.k7x, and one cheap call

The module's name goes into `graph.k7x`'s `bypassed` list, not into the module file: a module's
own file is what it IS, and being switched off is where it sits.

It reads `graph.k7x` alone rather than `loadGraph`. The only question is which chain holds this
module and whether it is on, and that is one file; `loadGraph` also reads every module, clip,
sequence and curve in the song — 220 ms on a real project, spent to answer a question `graph.k7x`
already answers in one. Still the DERIVED chains rather than the compiled doc, so a module that is
an io node or names nothing on disk is found too: bypass is the one verb that still works on a
dangling reference. A module belongs to exactly one chain — it is named once in the file — so there
is no "used in two chains, say which" to answer.

It then persists and pushes the mutated doc rather than reloading — the same trade a fader makes,
and for the same reason: a reload recompiles the whole song (another ~230 ms) to change one
boolean. The engine treats an enabled-flip as a live `setEnabled` on the plugin, never a rebuild,
so the diff is exactly one cheap call. An io module or a dangling step has no plugin in the
compiled doc and nothing to diff, so those fall back to the full reload — which is what makes their
`graph.k7x` edit take effect at all.

Beware the polarity: `bypass` is already the state wanted and `setModuleBypass` takes the state
wanted. Negating it writes the opposite of what the log line reports, so toggling an active module
does nothing at all — it "re-enables" what is already on.

## `node param` and its quoting

The NODE may be quoted as the param may: a node is named by its file, and a file may carry a space.
A `\S+` there stops at the space and the whole line fails to match — which the graph's own fader
walks into, since it names the mixer node it found rather than a name someone typed.

The VALUE may be quoted too, and that is not symmetry for its own sake: a file-valued param
routinely names a path with spaces in it,
`nam "roland jc 120b/Roland JC 120B Jazz Chorus_ Bright Off.nam"`. Anchor the value as `(\S+)$` and
it can never hold a space whatever the caller does — the lazy `(.+?)` for the param swallows the
whole path and the LAST token becomes the value, so picking an amp refuses with `"101.nam"" is not
a number`, a message naming the tail of the file it has just cut in half, which points nowhere near
the cause.

One module in two chains is TWO `PluginDoc`s, so a write patches every one: the first alone leaves
the other stale. The file is written first, being the source of truth, then the engine is patched
in place with one `PluginParamChanged`.

A node is found on the master run as well as on the lanes: `collectPluginModules` walks
`masterPlugins` too, and `mapPlugins` patches both. A mastering node (`MIX → master → OUT`, a
quick-master) plays on no lane, so a lookup over `tracks` alone refuses every knob of the
mastering surface while the file and the engine would both have taken the value.

## `module cc`

Binds a MIDI control to a param, or `none` to unbind. The param is read as everything BETWEEN the
module and the trailing numbers, since plugin display names contain spaces (as in `node param`).

It writes a file and nothing else: the binding is played by the BROWSER's Web MIDI, so there is no
engine state to patch and no project to re-apply. The reload the caller does afterwards is what
carries the new map to the graph. The map is the MODULE's, so it plays for every use of it — the
log says so rather than letting it be found.

## `node automate`

The param may contain spaces ("Filter Freq"), so it is taken as everything between the module and
the LAST one or two words rather than split on whitespace: a quoted argument would be a second
spelling of a thing this bar has never needed quotes for. The last word is the curve unless the one
before it is ALSO a known module — which is what a trigger is, and the only shape that tells the two
apart without quoting.

`none` for the curve takes the binding off — the same word `node param` uses for a value it
removes, rather than a second verb whose only job is to undo this one.

`curve new <name>` scaffolds `curves/<name>.k7x` as an LFO, the one shape with defaults worth
having (see `createCurveFile`). Binding it is a separate step: a module's `automation:` names the
curve, so the curve has to exist first.

## `project surface new`

Declares a special view — the arrangement, the frame, or the desk. A project draws nothing it has
not asked for, and until this verb the only way to ask was to write the file by hand, which the two
`surfaceIssues` warnings tell you to do while naming a file you then have to create in the editor of
the project that is missing it.

Under `project`, beside the markers: a surface is a property of the PROJECT —
what it draws — rather than of a track, a node or a clip inside it.

NO layout argument. `SURFACE_LAYOUTS_BY_TYPE` already says which one each type is drawn in and every
type has exactly one, so the only thing an argument could add is a way to be refused by the schema a
moment later. The usage string is spelled from the enum rather than by hand: a hand-written list
goes stale the moment a kind arrives, and a usage string that omits the word you wanted is worse
than none — it reads as "that is not a surface".

## `module new`, `node new`, `node insert`, `node delete`

`module new <category>/<name> [extends-ref]` scaffolds a workspace module and only that. The
optional arg is the ref this module INHERITS. It makes no node: a module and a USE of it are two
things, and a chain names the use. A module that is already there is not an error. Nothing but this
verb writes into the workspace's `_modules/`: making a module is a decision somebody takes, never a
side effect of adding a node.

`node new <category>/<name> <node-name> [x,y]` writes one USE of an existing module, as
`nodes/<node>.k7x`, AND its place in the graph. It names what it uses with `extends` and states
only what it changes; chains name it by its FILENAME alone. The placing is not a convenience: a node
file with no entry in `graph.k7x` is loaded and drawn NOWHERE — the graph's blocks come off the
chains, so a node created without one exists on disk and is on no screen. Every node is in the
graph, and `modules: { x: [] }` is what says so. Unnamed, it gets `<module>_<n>` with no lane prefix
— a node born here is wired to nothing, so there is no run for it to be named after yet. The `+` on
an arrow DOES know one and spells the name out (the frontend's `nodeInsert.ts`); this is the bare
form, for a line somebody typed.

An optional `extends-ref` — any token carrying a slash beyond the target, so its position next to
the node name is free — makes the node extend THAT ref directly, the `<category>/<name>` then only
naming the node by default. This is what the graph's `+` sends for a CATALOGUE pick. No workspace
module is scaffolded in between: a one-line module that only extends a library one hides the
library module's preset shelf, since presets are keyed by what a node extends
(`packages/song/docs/userPresets.md`), and adds a file nobody chose to own.

`node new @<library>/<category>/<name> [<node-name>] [x,y]` — a WHOLE ref in the target's place —
makes the node extend that ref as it stands, with no workspace module in between
(`packages/song/src/nodeOnRef.ts`). It is for a module that is already right as it is, the
library's `k7-rack` being the case that needs it: the rack builder's kit is a node of it, and a
local shim extending it would be a second file standing for the same sampler. The ref must resolve.

**io is the one category where the node IS the module.** `node new io/IN <name> [x,y]` writes
`modules/io/<name>/module.k7x` — no `nodes/` file, the graph naming the module bare — with the role
the canonical arg spells: `IN` the interface input, `CAM` the camera, `FILE` the file source. A
second input is `node new io/IN IN2`: the NAME is the node's, the ROLE the arg's. OUT and CUE are
refused — MIX, OUT, CUE, RENDER and VIDEO_OUT are built into every graph and take no node — and so
is any name outside the vocabulary, `module new io/…` held to the same rule.

**Where it lands is answered here too, never left to the layout.** With the trailing `x,y` — the
click, which the graph's create flows carry through unclamped — it is pinned there. Without one it
is pinned at `0,-30`, just above the origin: this node is wired to nothing, which is precisely the
case a fresh dagre pass has least to say about, so it goes wherever that pass happens to put it and
somebody has to go looking for what they just made. A fixed spot is findable, and one drag moves it.
The cost, stated: type three of these in a row and they stack on each other, which is visible and
fixable rather than quiet.

`node insert <before> <after> <node> [x,y]` splices a node that EXISTS into an arrow. Creating is
`module new`'s and `node new`'s; this WIRES, which is what keeps the two acts tellable apart. The
arrow is validated from `graph.k7x` alone, and a COLD module is refused here rather than halfway
through: it works only on audio already on disk, so where it sits is the question.

Its birthplace follows the same rule as `node new`, with a better answer available: the trailing
`x,y` when the `+` sent one, else the **midpoint of the two ends' pins**, which is where the cable
it was spliced into ran. That works because the drawing writes its own pins down the first time it
lays a graph out (`graph pin`, above), so both ends have one by the time anybody splices; a project
no browser has ever drawn has neither, and there the node simply keeps whatever pin `node new` gave
it. It does NOT re-space the neighbours — two cards already touching leave a midpoint that overlaps
them both, and `graph organize` is the way out, the same as for any other pin.

One arrow is accepted **before** the file states it: `MIX → OUT`, and the picture's
`RENDER → VIDEO_OUT`. The graph DRAWS a sum straight to its device whenever anything reaches the
sum, whether or not a master run is written (`packages/song/docs/masterChain.md`), so a `+` there
addresses a wire that is on screen and not in the file. The verb writes the run and then splices
into it, in that order — one command, which is what the `+` promises. Only when the sum feeds
NOTHING: a sum already running somewhere else is refused as any other non-arrow is, since accepting
it would silently split the master bus rather than extend it.

`node delete <node>` removes the node's file, its preset and its place in the graph. The splice is
`graph unlink`'s — what fed it is rejoined to what it fed, so a run does not go quiet — and what
this adds is that the files GO, which is why it is a different verb and not a flag. The module it
uses is untouched.

No verb DELETES a module: a module's files are the file tree's to remove, and other projects read
the same module.

## `node replace`

ONE edit, to one line: the node's `extends`. What goes with it is what described the old thing
(`plugin`, `params`, `rack`), and the log says which, because a field disappearing from a file
somebody hand-wrote should never be discovered later.

…and then its NAME follows, when its name was ours to move. A node the graph's `+` created is called
`<lane>_<module>_<n>`, so one still wearing `vo_jo_reverb_1` while it extends a delay is a name that
lies about the one thing a name here carries. One somebody called `wash` means `wash` and is left
alone — see `renamedInstance`, which decides which is which and is the same rule that made the name
in the first place.

The rename is the SECOND act and cannot be folded into the first: `setModuleExtends` writes one line
of one file, while moving a name touches the file, its preset and every chain step that spells it.
If it declines, the replacement still stands — a node with a stale name plays correctly, and a
half-done rename does not.

It creates no module and rewires nothing: from the node's context menu the only thing worth naming
is the replacement.

## The graph's layout verbs

`graph organize` hands EVERY node back to the layout: the pins come off in one write and dagre
speaks again on the next draw. Deliberately the ONLY reorganizing operation — an edit keeps every
card where it stands (the renderer holds them), so the picture moves exactly when somebody asks it
to.

`graph move <node> <x> <y>` pins a node where a drag put it, into `graph.k7x`'s `positions:`. The
layout only places what has no pin, so this is the one write behind "modules stay where you moved
them"; `auto` hands the node back. Cosmetic on purpose — nothing about the signal reads it — which
is why a bad node name is still refused: a pin nothing can ever match would sit in the file for
ever. Negative coordinates are allowed and are the point: a node belongs above the first track as
readily as below it.

**"A node this project knows" includes the four BUILT-IN outputs.** `MIX`, `OUT`, `RENDER` and
`VIDEO_OUT` have no folder under `nodes/`, so every test of the form "is this a module" has to ask
`isBuiltinOutput` on the side — and three verbs here had each answered it their own way. `graph
move` did not ask at all, so dragging `MIX` or `OUT` refused with a list of modules they were never
going to be in; `graph chain connect` and its replug twin spelled `name === "OUT"` by hand, which
left a set's `fadeA: [ MIX ]` unwireable from the picture. One `namesANode` now, because the rule
that everything on the graph is a node is only true if every gate agrees on it
(`packages/song/docs/graphModel.md`).

`graph chain connect <from> <to>` is the patch-cable gesture and how a new chain begins. Unlike
`node insert` there is no existing arrow to validate against, so the checks are the ends themselves:
both must be nodes this project knows, the sink has no output, and a lane takes only what a live
input puts on it (`runCarriesInput`). That last check is about the RUN and not the lane: refusing
every track outright would be stricter than the thing it guards and leave an `IN` node with nowhere
to go — see `packages/ui-chains/docs/graphBuild.md`.

## `transport arm` writes no file

Arming is session state that dies with the engine, so there is nothing to write — which is why it
sits under `transport` and not `track`: it names a lane, but it is a message to the engine, like
play and stop. The two checks here are the SONG's: does the track exist, does it declare an input.
The engine re-checks and adds what only it knows. No input, no arm: a track with nothing feeding it
would record silence.

Bare, it TOGGLES, and the engine resolves the toggle, so two surfaces never both read "off". With
`on` or `off` it SETS: a caller acting before the engine has echoed an earlier arm — Record pressed
right after a lane's A, which arms "the only track" when nothing reads as armed yet — states what it
wants, since its toggle would undo the arm still on its way.

## `transport metronome volume`

A PROJECT setting like the flag beside it, so it rewrites `settings.k7x` and re-sends; the engine
reads it off the compiled document and never off a live control.

The floor is 0.2 and it is not this command's invention: Tracktion clamps its click gain to 0.2..1,
so a smaller number would be accepted here, written to the file, and then played at 0.2 — a project
stating a level nobody hears. Refused by name instead, and the message says where silence actually
lives.

## Every verb lives in `verbs/`, and `commands.ts` only gathers them

- Each group is one table, `XXX_VERBS`, in a file of `verbs/` named after its namespace (`node.ts`,
  `nodeTap.ts`, `event.ts`, `eventStrip.ts`, `sequence.ts`, `project.ts`, …). `commands.ts` holds
  the `CommandHost` and `SidHandler` types, lists the tables in `VERB_TABLES`, and builds
  `SID_HANDLERS` from them. A SID sits in exactly one table: `registry.test.ts` fails on a second,
  since a later table would otherwise override an earlier one without a word.
- A verb file imports TYPES from `commands.ts`, which are erased at compile time, and VALUES only
  from other verb files, since `commands.ts` imports every one of them and a value import back into
  it would be a real cycle at runtime.
- What several groups need and none owns sits in `verbs/shared.ts` (`splitWords`, `splitArgs`,
  `firstArg`, `resolveEvent`, `rendererOf`, `playlistFile`). The writers behind `node param`'s
  non-plugin names sit in `verbs/intrinsics.ts`.
- A plugin's verb goes in through `registerVerb` alone, which installs the catalogue row and the
  handler together: either half without the other is a verb that reads and never runs, or runs and
  never reads. Both halves refuse a word or SID already taken, so a clash fails at install, not at use.
- `commands.ts` re-exports `splitWords`, `collectSequences`, `parseMidiNote` and
  `collectPluginModules`, which the completions and the tests import from there.
