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

`stemsChain` is handed in for a different reason. The file is one import away and other `system`
verbs do read `~/.studio/preferences.yaml` directly — but a suite exercising "no chain named"
would otherwise pass or fail by whether whoever runs it has set one. The verb that WRITES it
still writes it directly: that is its whole job.

`snapshot` backs up a file about to be overwritten, so undo can restore it. The web host wires it
to its edit journal; the CLI leaves it undefined and simply overwrites.

`EVENT_FIELDS` lists everything a placement may say beyond WHERE it goes — what `events add`
forwards to `PlacementSchema`, and so what a paste can reproduce. `ref` and `start` are handled
apart: every event has those two, and `start` is the one field a paste re-spells. Listed rather
than spread from the payload so a key nobody meant to accept cannot ride in. The schema is
`.strict()` and would refuse it anyway — but refusing a MISSPELLED field loudly is only useful if
the right ones are named somewhere a reader can find them.

## `renders/` — where a freeze lands

One folder for the lot, at the project root. NOT beside the module's own file: a node's folder is
`nodes/`, shared by every node in the song, and a module from a catalogue has a folder shared by
every song. A render belongs to THIS project, so it lives where the project can see all of them at
once.

## Timecodes as YAML keys

The project's `markers` map is written with QUOTED keys. Unquoted, `2:1:1` is a YAML 1.1
sexagesimal integer. The code said so for a long time and wrote them bare anyway: `setFileValue`
gives every key the plain style, and `quoteTimecodes` walks VALUES under known keys, so neither
could see a timecode used as a key. `setQuotedKeyMap` is that sentence, implemented.

## Position vs. duration

Several verbs take both, and nothing downstream can tell them apart — both spellings are legal
timecodes, so getting the pair the wrong way round writes a fade several bars long and reports
success.

- `event fadein|fadeout <track> <timecode> <length>` — `parsePosition` for the first (inside
  `resolveEvent`), `parseDuration` for the second. A length of 0 REMOVES the fade rather than
  writing a zero.
- `project add|remove <at> <length>` — `at` is a position, `length` a duration. The caret
  pre-answers `at` (st0's `commandFill`'s `CARET_ANSWERS`), so from the timeline this reads
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

## One implementation, two commands

Three families are one function taking the word it writes, because the only thing that differs is
what the noun promises:

- `track process` / `clip process` — what the first argument may name.
- `event status mute|warp` — which aspect of the event moves.
- `event fadein` / `event fadeout` — which end of the clip the fade is on.

That difference is worth a command each: the word after the verb is the promise, and it leaves
room for a third without renaming anything.

### `event status` and the polarity that bit

**`on` means the NAMED STATE is on**, in both: `event status mute on` silences the event, and
`event status warp on` makes it FOLLOW the clip's map. One rule, no exception to remember.

It was not always so. Under the old head both aspects named something negative — `event disable
play`, `event disable warp` — so `on` meant "the disabling is on" and the two read alike. Renaming
the head to `status` broke that symmetry: `mute` is still a negative to switch on, `warp` is a
positive, and `warp on` went on meaning UNwarped. The `!` that produced it sat on the call to
`setTrackPlacementWarp` and is gone; both writers now take the state under its own name.

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

## `track new` has no kind

It was `track new audio` and `track new midi`. A lane is not typed by what it carries any more:
one lane holds events naming clips and events naming sequences alike
(`packages/song/docs/trackModules.md`). What the MIDI flavour did beyond making a lane — seeding
the empty sequence it played — is `sequence new`, which is what that half was really about.

## `track mute` — a lane's mute IS its module's bypass

One state, in the one place a bypass is written (`packages/song/docs/trackModules.md`). A group is
a lane too — one that carries no signal — and both are silenced the same way, by name, in
`graph.yaml`'s `bypassed:`. Solo stopped being a set of mutes: it is project state now (`soloed:`
in `project.yaml`). The doc is mutated and pushed rather than reloaded, so a mixer move stays
snappy.

## `node alternative` reads the FILE

The names are read off the module's own file rather than off the compiled doc: an alternative may
change any field, so the doc carries the chosen one collapsed in and has nothing left to say about
the others. See `packages/song/docs/alternatives.md`.

The take verbs read the file for a related reason: the count comes off the file rather than off
the compiled project, so a take can still be deleted on a lane the compiler is currently refusing.

## `module new` writes a module and stops

The picker offers two kinds of thing and `makeModule` handles both: something from the CATALOGUE
(no local folder yet — create one extending it), and a module this project already has (leave it
alone, do not recreate it). Already there AND told to inherit something else is a real
disagreement rather than redundancy: a module cannot be re-parented by asking for it again, so
acting would ignore what was typed.

It does NOT make a node. What a chain names is a node, and creating one is `node new`'s — which
also puts it in the graph, since a node with no entry there is drawn nowhere. Bundling the two
here is what made "create a module" and "start using it" one act that could not be had separately.

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

## `curve point add|move|remove`

The verbs the timeline's automation row was waiting for. Until these, a `custom` curve could be
created flat (`track automation add`) and shifted wholesale (`project add`), and its individual
points could only be typed into the file by hand — which made the row a picture of something you
could not touch.

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
lane IS. `packages/song`'s `graph.ts` asks the same thing of the chain whose `out` names the track,
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

Its own fields, in a table rather than a verb apiece (`module channel`, `module monitor`), because
from the outside they are one act: set this control on this module. The `@` is the whole of the
difference from a plugin param — a param is sent to a running plugin, a field is written into the
file and read when the module is BUILT.

That is also what makes them reachable from a widget: a `bind: "@channel"` in a module's `ui.yaml`
needs no command of its own, and the day a fourth field is bindable it needs no verb either — one
line in the table. See `packages/song/docs/intrinsics.md`.

Each entry takes the value as TYPED and answers with what to say about it, or throws the sentence
that says why it cannot.

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

`nam` and `onnx` (`moduleTypes`' `FILE_PARAMS`) are params like any other — they land in `params:`
beside the numbers — but their value is a filename, so two things differ. It is checked against the
assets the module actually carries, and it is NOT patched into the running engine: a plugin loads
its file when it is BUILT, so the handler writes and reloads. Swapping an amp model is not a knob
drag.

They had a verb apiece (`module nam`), and the second one never got written: the asset picker sends
`${param} …` for whichever param it was opened on, so picking an `.onnx` reached a command that did
not exist. One branch answers both, and the next one costs nothing.

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
`module.yaml` to land in and lands in `project.yaml` instead. That is a storage detail and not a
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

`track.new` and `sequence.new` used to hand a doc built in memory to `applyProject`, which caches
it and tells the engine — so a strip appeared in the mixer, nothing was written, and the track
vanished on the next reload. A track IS its file: write it, then reload, so what plays is what is
on disk.

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

It was `clip trim` and wrote the CLIP's window, which every placement of that clip shared. There is
no clip window any more — a clip file describes the bytes, a placement describes the use
(`packages/song/docs/materialCut.md`) — so it names the event it acts on, and trimming one
placement leaves the others alone by construction rather than by a warning in the help.

## `clip warp`

One verb places and moves, because from the waveform they are one gesture: you drag a mark to a
beat, and whether one was already there is not something you decide beforehand.

A clip with no map gets its two anchors seeded from its own length. Seeding alone changes no sound
— an identity two-point warp is skipped by the engine — so the FIRST call on an unwarped clip
writes a map and a point in one go, which is what makes the gesture whole.

## Solo is PROJECT STATE

`soloed:` at `project.yaml`'s root lists the soloed lanes — several at once — and the ENGINE
resolves it across the mixer (any soloed track silences every non-soloed one; `applySoloMute`). The
compiler folds a group's entry onto its members.

It used to be DERIVED — bypass every other lane — which rewrote N files to say one fact, could not
hold two solos at once, and read in `graph.yaml` as a wall of mutes nobody wrote. Now one list says
it, and turning the last solo off deletes the key: absent means what it always means here, the
default.

Soloing a MUTED lane still lifts its mute, as the old gesture did — asking to hear a lane is one
act. The doc is mutated and pushed rather than reloaded, so the mixer stays snappy, with the same
fold the compiler applies.

## `track take keep`

Named for the decision rather than for what it removes: you have listened round the takes (each
listen is a `select`, which leaves the one you liked ON the track), and this is the button that
says that one. Nothing names a take, because the choice was already made by whichever is playing.

## Verbs that left the `track` family

`track gain` and `track pan` are `node param <mixer node> Volume|Pan` now. A track states no level
of its own — the value always went to the MIXER MODULE at the end of its chain — so two verbs
addressed one module's params by the wrong noun, and every other param on that same module already
answered to `node param`.

`track alternative select|create|copy` and `track freeze` are `node alternative *` and `node
freeze`, because a lane IS a module: one name reaches a lane and a reverb alike. See
`packages/song/docs/trackModules.md`.

There is no `track normalize` / `clip normalize` either: normalising is a treatment, and a
treatment is a chain — `track process` / `clip process` apply one.

## `event move` between lanes

A destination track makes it a move BETWEEN lanes, refused only when the destination has nowhere to
put THIS event. It used to compare the two lanes' `contentType`, which refused every move between
an audio lane and a sequences one — a lane is not typed now, so the question is about the event: a
lane takes a note when its midi output is wired and a clip when its audio one is, and the wire says
which in one word (`packages/song/docs/trackModules.md`).

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

`virtual`'s pair. Where that one leaves two placements of one material, this writes two materials
and points a placement at each — so the halves can then be trimmed, processed or warped apart,
which is the whole reason to want it.

The KIND decides which half of the implementation runs, and they are genuinely different acts: a
sequence is divided note by note in text (`@studio/song-edit`'s `materialCut`), while audio is
RENDERED twice through the engine (`@studio/take-render`'s `materialRender`). So this one needs a
machine and the virtual split does not — and when there is no engine binary it says exactly that
rather than failing somewhere further in.

What was cut is left on disk, both kinds. Another placement on another lane may still be playing
it, and nothing here can know what was meant to be kept.

## `selection consolidate`

Put a range back together, whatever is in it — a split rejoined, two materials merged, a stack
flattened, all by one act. `event join` stood beside it and only ever rewrote placements, which
meant it held out for the one arrangement where nothing had to be written; it is gone with the
virtual split, and this writes in every case.

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

It takes the WHOLE placement vocabulary, not just where the event goes: a paste that carried only
`ref` and `start` put down an untrimmed, unfaded, single pass of the material wherever the copied
event had been trimmed, faded, silenced or repeated. The extra fields are validated against
`PlacementSchema` rather than field by field — that schema is `.strict()`, so a key this verb has
no business writing is refused by name instead of landing in the file, and the window's `to > from`
rule is enforced in the one place it is stated.

## `graph pin`

The other half of `graph move`, and the reason the picture stops rearranging itself: a node the
LAYOUT placed is unpinned, so the next fresh layout is free to put it somewhere else, and it will
whenever anything about the graph changed. That is what made the track row seem to shuffle at
random — the change surfaced at a reload, long after the edit that caused it.

So the drawing writes its own answer down, once, and after that the FILE is the layout. dagre
speaks again only when `graph organize` empties `positions:`.

A batch and a single write: sixty nodes recorded as sixty commands would be sixty entries in the
undo journal for one picture nobody moved by hand. It never overwrites an existing pin (see
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

## `node bypass` — graph.yaml, and one cheap call

The module's name goes into `graph.yaml`'s `bypassed` list, not into the module file: a module's
own file is what it IS, and being switched off is where it sits.

It reads `graph.yaml` alone rather than `loadGraph`. The only question is which chain holds this
module and whether it is on, and that is one file; `loadGraph` also reads every module, clip,
sequence and curve in the song — 220 ms on a real project, spent to answer a question `graph.yaml`
already answers in one. Still the DERIVED chains rather than the compiled doc, so a module that is
an io node or names nothing on disk is found too: bypass is the one verb that still works on a
dangling reference. A module belongs to exactly one chain now — it is named once in the file — so
the "used in two chains, say which" branch is gone.

It then persists and pushes the mutated doc rather than reloading — the same trade a fader makes,
and for the same reason: a reload recompiles the whole song (another ~230 ms) to change one
boolean. The engine treats an enabled-flip as a live `setEnabled` on the plugin, never a rebuild,
so the diff is exactly one cheap call. An io module or a dangling step has no plugin in the
compiled doc and nothing to diff, so those fall back to the full reload — which is what makes their
`graph.yaml` edit take effect at all.

Beware the polarity: `bypass` is already the state wanted and `setModuleBypass` takes the state
wanted. Negating it wrote the opposite of what the log line then reported, so toggling an active
module did nothing at all — it "re-enabled" what was already on.

## `node param` and its quoting

The NODE may be quoted as the param may: a node is named by its file, and a file may carry a space.
It could not be addressed at all before — `\S+` stopped at the space and the whole line failed to
match — which the graph's own fader walks into, since it names the mixer node it found rather than
a name someone typed.

The VALUE may be quoted too, and that is not symmetry for its own sake. It was `(\S+)$`, so a value
could never contain a space whatever the caller did — and a file-valued param routinely names one:
`nam "roland jc 120b/Roland JC 120B Jazz Chorus_ Bright Off.nam"`. The lazy `(.+?)` for the param
then swallowed the whole path and left the LAST token as the value, so picking an amp refused with
`"101.nam"" is not a number` — a message naming the tail of the file it had just cut in half,
which points nowhere near the cause.

One module in two chains is TWO `PluginDoc`s, so a write patches every one: the first alone leaves
the other stale. The file is written first, being the source of truth, then the engine is patched
in place with one `PluginParamChanged`.

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

`curve new <name>` scaffolds `curves/<name>.yaml` as an LFO, the one shape with defaults worth
having (see `createCurveFile`). Binding it is a separate step: a module's `automation:` names the
curve, so the curve has to exist first.

## `project surface new`

Declares a special view — the arrangement, the frame, or the desk. A project draws nothing it has
not asked for, and until this verb the only way to ask was to write the file by hand, which the two
`surfaceIssues` warnings tell you to do while naming a file you then have to create in the editor of
the project that is missing it.

Under `project`, beside the markers and the alternatives: a surface is a property of the PROJECT —
what it draws — rather than of a track, a node or a clip inside it.

NO layout argument. `SURFACE_LAYOUTS_BY_TYPE` already says which one each type is drawn in and every
type has exactly one, so the only thing an argument could add is a way to be refused by the schema a
moment later. The usage string is spelled from the enum rather than by hand: it listed three of the
four for as long as it took a fourth kind to arrive, and a usage string that omits the word you
wanted is worse than none — it reads as "that is not a surface".

## `module new`, `node new`, `node insert`, `node delete`

`module new <category>/<name> [extends-ref]` scaffolds a module and only that. The optional arg is
the ref this module INHERITS, filled by the graph's module picker when the pick comes from a
catalogue rather than from this project. It used to take a node name too and make one in the same
breath, which is why the picker could send one line. It does not: a module and a USE of it are two
things, and a chain names the use. A module that is already there is not an error — it is the
ordinary second pick of the same thing.

`node new <category>/<name> <node-name> [x,y]` writes one USE of an existing module, as
`nodes/<node>.yaml`, AND its place in the graph. It names what it uses with `extends` and states
only what it changes; chains name it by its FILENAME alone. The placing is not a convenience: a node
file with no entry in `graph.yaml` is loaded and drawn NOWHERE — the graph's blocks come off the
chains, so creating one used to leave a node that existed on disk and was on no screen, waiting for
a second command to become real. Every node is in the graph, and `modules: { x: [] }` is what says
so. Unnamed, it gets `<module>_<n>` with no lane prefix — a node born here is wired to nothing, so
there is no run for it to be named after yet. The `+` on an arrow DOES know one and spells the name
out (the frontend's `nodeInsert.ts`); this is the bare form, for a line somebody typed.

`node insert <before> <after> <node> [x,y]` splices a node that EXISTS into an arrow. It used to
create the module too, which is what made it read as a duplicate of `chain add` — they were one act
told apart by whether a file had to be written first. Creating is `module new`'s and `node new`'s;
this wires. The arrow is validated from `graph.yaml` alone, and a COLD module is refused here rather
than halfway through: it works only on audio already on disk, so where it sits is the question.

`node delete <node>` removes the node's file, its preset and its place in the graph. The splice is
`graph unlink`'s — what fed it is rejoined to what it fed, so a run does not go quiet — and what
this adds is that the files GO, which is why it is a different verb and not a flag. The module it
uses is untouched.

Three verbs are gone and their state with them: `module.delete` (a module's files are the file
tree's to remove), `node.place` (`node new` places what it makes and `graph unlink` leaves what it
unlinks) and `chain.addModule` (that is `node insert`).

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

It used to CREATE a module and rewrite the chains onto the new name. That answered a different
question ("put a new module where this one sits"), and from the node's context menu it asked for two
things when the only one worth naming is the replacement.

## The graph's layout verbs

`graph organize` hands EVERY node back to the layout: the pins come off in one write and dagre
speaks again on the next draw. Deliberately the ONLY reorganizing operation — an edit keeps every
card where it stands (the renderer holds them), so the picture moves exactly when somebody asks it
to.

`graph move <node> <x> <y>` pins a node where a drag put it, into `graph.yaml`'s `positions:`. The
layout only places what has no pin, so this is the one write behind "modules stay where you moved
them"; `auto` hands the node back. Cosmetic on purpose — nothing about the signal reads it — which
is why a bad node name is still refused: a pin nothing can ever match would sit in the file for
ever. Negative coordinates are allowed and are the point: a node belongs above the first track as
readily as below it.

`graph chain connect <from> <to>` is the patch-cable gesture and how a new chain begins. Unlike
`node insert` there is no existing arrow to validate against, so the checks are the ends themselves:
both must be nodes this project knows, the sink has no output, and a lane takes only what a live
input puts on it (`runCarriesInput`). That last check used to refuse every track outright, which was
stricter than the thing it guards and left an `IN` node with nowhere to go — see
`packages/ui-chains/docs/graphBuild.md`.

## `transport arm` writes no file

Arming is session state that dies with the engine, so there is nothing to write — which is why it
sits under `transport` and not `track`: it names a lane, but it is a message to the engine, like
play and stop. The two checks here are the SONG's: does the track exist, does it declare an input.
The engine re-checks and adds what only it knows. No input, no arm: a track with nothing feeding it
would record silence.

## `transport metronome volume`

A PROJECT setting like the flag beside it, so it rewrites `settings.yaml` and re-sends; the engine
reads it off the compiled document and never off a live control.

The floor is 0.2 and it is not this command's invention: Tracktion clamps its click gain to 0.2..1,
so a smaller number would be accepted here, written to the file, and then played at 0.2 — a project
stating a level nobody hears. Refused by name instead, and the message says where silence actually
lives.

## What left this file

- `PLAYLIST_VERBS` and `SYSTEM_VERBS` moved to `verbs/`. They import TYPES from here, which are
  erased at compile time, so there is no runtime cycle — see `verbs/shared.ts`.
- `playlistFile` went with them, into `verbs/shared.ts`: a helper left behind would have made
  those files import back into this one, which is the cycle the split exists to avoid.
- `splitWords` lives in `verbs/shared.ts` and is imported AND re-exported here — a bare
  `export … from` would not bring the name into this module's own scope, and several handlers
  below call it.
- `splitOptionals` is gone. It told an `[extends-ref]` from a `[node-name]` by SHAPE, because
  `module new` took both and they were positional. `module new` writes a module and nothing else
  now, so there is one optional left and nothing to disambiguate.
- `coldInsertError` is gone. The cold rule was asked of a module that did not exist yet, since
  `node insert` created one. It takes a node that IS there now, so the general
  `coldPlacementError` answers directly.
