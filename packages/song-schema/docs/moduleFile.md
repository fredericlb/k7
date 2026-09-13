# The module file

The rationale behind `packages/song-schema/src/yaml/moduleSchema.ts` and
`packages/song-schema/src/yaml/moduleFile.ts` — a `module.yaml`'s shape, the panel, the shelf and
the controller beside it, and the reader/writer pair over the lot.

## What the schema does not check

It deliberately does NOT check reference fields (`extends`, a rack's `clip`): those need the rest of
the project and live in TS instead — `graph.ts`'s `validate()` and `nodeProject`'s ref pass.

## Ports a module declares for itself

`mandatory` is an INPUT's business — an output is offered, never required — and defaults to true
where it is read, so a port a module bothered to name has to be fed unless it says otherwise. A
crossfade's second input is exactly the case for `mandatory: false`: wiring one side and leaving the
other silent is a legitimate state, not a half-built chain (`packages/song/docs/ports.md`).

`inputs:` / `outputs:` are declared on the module because the folder says what a module IS, not how
many wires it takes: a crossfade is an audio effect like any other and needs two audio inputs, which
the folder alone cannot say. A module that declares neither keeps its type's ports, which is every
module written so far.

## The widget vocabulary

A `fader` is a mixer strip's fader: vertical, and it fills the height its `rowSpan` gives it, which
is the point — a fader you cannot make tall is a slider stood on its end.

A `filepicker` picks a FILE the module carries for a file-valued param (`bind: nam`). Its own type
rather than a flavour of dropdown: it lists a folder tree with a search field, not a set of values
the panel author wrote down (`packages/song/docs/filePicker.md`). A file picker with nothing to pick
FOR is a button that cannot say what it would write — the param it binds is where the chosen file
lands, and there is no default worth guessing — so `bind` is required on one.

`WidgetSchema` is a refinement rather than a union, because a union would reject the half-second
where the editor changed `type` but not yet the fields.

## The three files beside `module.yaml`

`ui.yaml` is the panel, at the top level of a file of its own, so the plugin scan can rewrite the
module without touching hand-drawn work. It says nothing about WHICH module it draws: the folder it
sits in does (`uiLibrary.ts`).

`presets.yaml` is the module's named settings. A preset IS its values — the key names it, the folder
says which module it belongs to, and there is nothing else to record. Numbers only, because that is
what a module's `params:` holds and a preset that could not be written there would be one that
cannot be applied (`presets.ts`).

`controller.yaml` says which MIDI control moves which of the module's params. The key is the param —
one control per param, because two controls fighting over one value is a bug rather than a feature
(`packages/song/docs/controller.md`). Its channel is 1..16 as a musician counts them, not 0..15 as
the wire does: this file is read by people.

## Automations

`trigger` names the module whose NOTE-ONS restart the curve, and only an envelope reads it: a curve
of song time is fired by nothing and runs whether anything plays or not. Absent, an envelope is
triggered by the module it drives, which is the case that needs no saying — a filter envelope on a
synth follows that synth's notes.

## `MODULE_FIELDS`, and why it is its own object

An ALTERNATIVE is a module partial: the same fields, minus the two that say where a module comes
from. `MODULE_FIELDS` is written once and spread into both schemas, so a field added to a module is a
field an alternative can set, without anyone remembering to
(`packages/song/docs/alternatives.md`).

`plugin:` is deliberately open — a plugin's shape is the ENGINE's business, matched as strings
against its scan cache.

`type:` is NOT a `.default()`: the loader applies it (`moduleFile.ts`) so the file stays as terse as
authored. `status:` is not one either, for the same reason — the loader applies `listed`, so a file
that has nothing to say about it stays a file that says nothing.

A file that `extends` gets NO type filled in, because a merge cannot tell a default from a
decision: a node over a rack states nothing, and a `plugin` written in for it would beat the
parent's `rack`. The node would then draw "missing plugin" and compile as an empty slot — a drum
rack that plays nothing. The type of a chain is the type of its ROOT unless a link overrides it.

There is no `jsdsp:` field. A module whose DSP is its own source says so with
`plugin: {type: jsdsp}`, and the file is `jsdsp.ts` beside the module file — one statement rather
than a field and a type that have to agree (`loader.ts`'s `jsDspFileFor`).

`ModuleSchema` is `.strict()`: an unknown key is a typo, and silently ignoring `paramz:` is worse
than saying so.

## `shader:`

A field and not a param, and the same distinction `base` draws: `params:` holds numbers the running
thing is steered by, and this decides which program is COMPILED. The four knobs are params
(`P1`..`P4`); the choice of shader is not one of them. It is a bare name, checked as one: a shader is
a folder the module carries, so a value with a separator in it is refused here rather than resolved
into somebody else's module. Absent is a real state — a shader node with nothing picked passes its
picture through untouched, which is what a node you have just added should do
(`packages/song-video/docs/shaders.md`).

## `params:`, and the few that are files

A param is a NUMBER, except the few the plugin steers with a file it loads: `nam` names a `.nam`
model in this module's own `assets/`. It sits in `params:` because that is what it is, one of the
plugin's controls shown in the panel beside Input and Output; a top-level field of its own would be
a second kind of thing to find, edit and merge. Only the file-valued ones are strings
(`moduleTypes.FILE_PARAMS`), and `nodeProject` lifts them out before the wire, which stays numeric
(`packages/song/docs/moduleAssets.md`).

## `cold:`

A COLD module only works on material already on disk, because it has to know the whole of its input
before it can produce any of it. Normalisation is the plain case — the gain depends on the loudest
sample, which may be the last one. Not "expensive": a cold module run live would not be slow, it
would be wrong, since the answer does not exist yet. It is a property of the MODULE, so it is
inherited by every use of it — deliberately not in `moduleResolve`'s `OWN_ONLY`, since a node of a
cold module is cold (`packages/song/docs/coldModules.md`).

## The io fields

`channel:` says WHICH interface input an io `in` module is, and nothing about where the signal goes:
the chain it sits in already names the track. There is no `track:` beside it, because a shared input
module — one per physical input, filed in a workspace's `_modules` — has nowhere to put a binding
that is per-project by nature.

`source:` is the audio FILE an io `file` module reads instead of an interface channel.
Project-relative, and named `source` for the same reason a clip's audio is: it is the same fact.
(`file` is taken — the loader writes the module's FOLDER name there, so an authored `file:` would be
overwritten by it.) It may be ABSENT, and that is the useful case
rather than an oversight: a chain template's input names none, because the template is generic and
whoever applies it supplies the audio — a song hands over its master
(`packages/song/docs/fileInput.md`).

`monitor:` is whether you hear the input while it plays. A BOOLEAN is the everyday answer —
`monitor: true` is what a person writing this file means — and the three-state spelling is there
because "auto" is neither: it means audible only once the track is armed, which is the default and
cannot be said with a boolean.

`gain:` is input trim in dB, applied at the interface before anything else sees the signal. 0 is
unity; a guitar into a line input usually wants some, a hot synth wants less. It is not a plugin's
`params:` — there is no plugin here, the input IS the module.

## `base:`

A named base is a file in the module's own `base/` folder, without the extension (`base: warm` is
`base/warm.vstpreset`). It is for the plugins whose sound is NOT in their automatable parameters,
which is most of the big commercial ones: `params:` holds named numbers, and an Arturia patch is not
named numbers. The base is the opaque state under them — UNDER, and that ordering is the whole
design: the engine loads the base and then applies `params:` on top (`applyPluginParams` in
`EditBuilder`, "text params override the preset"). So a base decides only what the module could not
have said in text, and every value the module DID author still wins. Picking a different base never
silently moves a param somebody set (`packages/song/docs/userPresets.md`).

## `content:` — a note on the graph

Multiline free text, shown as it is written on the node itself. A note is a THING IN THE GRAPH,
wired from what it is about, and read where you are already looking rather than in a panel you have
to go to. It belongs to a NODE in practice — every note is a node of `@studio/doc` — but it is
declared on the module like any other setting, because that is what makes a node able to override it
(`packages/song/docs/docModules.md`). There is no `docs:` and no `todos:`, here or on a lane, and
`.strict()` refuses a file that still carries either.

## A lane's own fields

They are accepted on any module and meaningful only on one that extends a `@studio/…-track`. The
schema deliberately does not police that: it validates ONE file, and which module a name extends is
a question about the whole project. `graph.ts`'s `validate()` reports an `events:` on a reverb,
exactly as it reports a `channel:` on something that is not an input — same rule, same place
(`packages/song/docs/trackModules.md`).

`events:` and not `clips:`, because a CLIP is the material — `clips/<id>.yaml`, a source and a
window into it — and one clip is placed on a lane any number of times. Calling both of them clips
gives a `clips:` list whose entries are not clips, next to a `clips/` folder whose files are. Every
surface says "event" in its prose (`event resize`, `event remove`, the timeline's own menus), and
the file says it too.

`disabled:` excludes the lane from the render entirely, chains and all — distinct from bypassing it,
which silences the lane while leaving it in the project's shape.

`strudel:` is a GENERATED lane's pattern, filled while the transport rolls, so it stands where
`events:` would. Which of the two a lane may write is decided by what it extends — an authored lane
has no pattern, a generated one has no placements.

`frozen:` is the render standing in for everything UPSTREAM of this module, this module included, as
a project-relative path. Its presence IS the frozen state — there is no second flag to disagree with
it. It sits on a module rather than on a lane because a freeze is a POINT IN THE GRAPH: what it
replaces is everything whose signal reaches here. It is in `MODULE_FIELDS` so an alternative may
carry its own: two sets of settings are two sounds, and a render of one is not a render of the other
(`packages/song/docs/freeze.md`).

## Writing the file back

The point of `moduleFile.ts` is not parsing, it is WRITING without reflowing the document or
dropping comments — st0 edits these constantly and they are in git.

YAML 1.2 is forced on the way in: a file may declare 1.1, whose sexagesimals and true-like scalars
are this app's vocabulary. An empty file is an empty module rather than an error, a scaffolded one
starting blank. `type: plugin` is the default applied on the way OUT, never into the file.

`locate` walks to the deepest node that exists, so an error points at the map that lacks the key
rather than at nothing. An unknown key is reported by zod against its CONTAINING object, so the path
is rebuilt from `keys` to give the key a line number.

### The two quoting traps

A value that LOOKS like a YAML 1.1 keyword (`on`, `no`, `y`…) is written quoted, exactly as the
scaffold writes it. We parse 1.2, where they are plain strings — but the file is read by people and
by other tools, and `monitor: on` meaning `true` somewhere else is the kind of thing nobody finds
twice.

`quoteTimecodes` runs after every write rather than at each call site, so nothing can forget. It
guards MODULE files and not just lanes, because a lane IS a module: `nodes/melody.yaml` carries
`events:` with a `start: "25:1"` in it, and unquoted that is a valid YAML 1.1 sexagesimal — bar 25
reads back as beat 1501, silently, in a file nothing else would complain about. A key set through the
document API arrives as a bare string rather than a `Scalar`, and a bare string has nowhere to carry
the quoting style — so it is promoted to a `Scalar` that does, and a sequence of them is marked item
by item. Looking only at `.value` would skip such a pair and let a freshly written `to: 3:1` out
unquoted, which is the one thing this function exists to prevent.

### `setModuleList`

Its own function rather than a branch in `setModuleValue`, because the difference is only how it
LOOKS and that one takes `unknown`: teaching it to reflow every array would restyle lists written by
callers that never asked. A two-element block sequence costs three lines to say one thing, and these
are files people edit as text first. `flow` is set on the NODE and not at stringify time, since only
this sequence should be inline.

### `setModuleAutomation`

Keyed by PARAM: one parameter is driven by one curve, so binding a second replaces the first rather
than stacking two lanes onto one knob. That is the model's rule, not this writer's — the compiler
bakes one automation lane per (plugin, param) and a second would silently win.

When a binding is taken off, "was this the last one" is counted BEFORE the delete: `items` is the
document's own array rather than a copy, so removing the entry shortens it under us and the test
would always read false. The empty list goes with the last entry, because `automations: []` says
something was authored and then emptied, which is not what taking a binding off means. A `trigger` is
written only when it is not the default: the compiler reads an absent one as the module being
automated, so writing that would be noise that goes stale the day the binding moves.

## A placement

`packages/song-schema/src/yaml/placementSchema.ts` is its own file because a placement is not a
track's alone: a lane is a module, so `moduleSchema` is what carries `events:` and this is what it
imports.

The `TIMECODE` shape is colon-separated numbers, then optionally `.ticks`. The dot makes the quoting
rule stricter rather than looser: `25:1` unquoted is a YAML 1.1 sexagesimal, and `1.5` unquoted is a
plain FLOAT in any YAML, so a tick form collides with a number more readily than a bare colon chain.
The colon chain may still run deep here: every file written before ticks existed spells its sub-beats
that way, and a schema that refused them would fail songs that load perfectly.

A placement's `from`/`to` take the same two spellings a clip's window does — and on a sequence, the
timecode is the only spelling that means anything, since its window is beat positions in the notes.

The window exists at TWO levels. The material's own file carries `from`/`to` — the window into the
sample or into the notes, shared by every placement of it — and a placement may carry the same two
words for ITSELF. The effective window is the most restrictive pair: the larger `from`, the smaller
`to`. An event can therefore only narrow what the material already plays, never reach outside it —
and `event resize` writes THESE, which is what makes a resize one event's edit instead of every
placement's (`packages/song/docs/clipResize.md`).

A placement has no `length` and no `offset`: its extent is derived, `loop` × the effective
window, and there is no second place for it to disagree with the material. `disabled` silences THIS
placement without removing it — the event-level counterpart of bypassing the lane itself — so its
position, length and fades survive being switched off and back on.

`warp` says whether THIS event plays the material's stretch map, absent meaning yes. `warp: false` is
the only value that says anything; `true` is the default written out. The polarity is that way round
because a warp belongs to the CLIP — one map, shared by every placement of it
(`packages/song/docs/warp.md`) — and this is a placement declining it. A `noWarp: true` would name
the same fact as a double negative, and a reader would have to work out which way `noWarp: false`
pointed. What it is for: one map fits the song the clip was warped INTO, and a second use of that
clip somewhere else wants the sample at its own rate, without a copy of the file.

`TIMECODE_KEYS` is what every writer in the repo quotes through. It carries the window's two words —
on a material file AND on a placement, the same trap for the same reason, and a NUMBER under those
keys is untouched since it is seconds — plus a curve point's `time`, which is not a placement's key
but is the same trap on the same kind of value (`packages/song/docs/curves.md`).

## Alternatives

One alternative is the same flat struct a module is, minus `extends` (an alternative belongs to the
module it sits in — it cannot re-parent it) and minus the alternatives themselves (one level, so
there is no tree to reason about). It normally states only what it CHANGES, exactly as a node does
over the module it extends — the merge is the same one. Its `name` is optional because an unnamed one
is known by its position, which is what makes trying a second set of settings cost nothing to name.

The module's own fields are the first alternative and are not repeated in `alternatives:`; those are
the ones after it. `alternative` picks one, by name or by 1-based position, and absent means the
first — which is why a project that never uses this keeps exactly the file it had
(`packages/song/docs/alternatives.md`).

`status:` is here and not in `MODULE_FIELDS`, which is what an ALTERNATIVE may restate: a module's
attribute sets are ways of playing the same block, and "this way of playing it is hidden from the
palette" is not a thing anybody means. It is one fact about the module, said once
(`packages/song/docs/moduleStatus.md`).

`label:` sits beside it for the same reason, and is the same kind of field: free text, the name a
person reads in a picker, resolving nothing and reaching no engine. An alternative already carries
`name:` for the one distinction it needs (`packages/song/docs/moduleLabel.md`).
