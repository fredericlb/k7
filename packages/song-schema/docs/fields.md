# The editor's field vocabulary

The rationale behind `packages/song-schema/src/yaml/fields.ts` and its test — the completions the
YAML editor offers, DERIVED from the Zod schemas rather than hand-kept.

## Why it is derived

The tables it replaces are 162 lines in `ui-editor`'s CUE completions, and they had drifted:
`library_from` was absent for as long as the field existed, then added to the tier where it does
nothing. Deriving from a single schema is what makes that impossible rather than unlikely, and each
kind of file answers for itself, which a single flat table could not do.

`automations` is the field the hand-kept table lacked, because the SHIPPED CUE schema lacked it too.
The GENERATED one (`#tdModule`, the enforced copy) has always had it, and real modules use it: the
two CUE schemas had drifted apart and the completion list followed the wrong one.

## `fileKindFor` — by folder, not by extension

`modules/audio/cab/module.yaml` is a module whatever it is called, and so is `nodes/melody.yaml` — a
node is an ordinary module that happens to live in `nodes/`, LANES INCLUDED
(`packages/song/docs/trackModules.md`). There is no `tracks/` kind any more for exactly that reason;
`validate.ts` has read the folder this way all along.

There used to be a `track` FileKind with a per-kind narrowing (`trackFieldsForType`), because
`type: single | group | strudel` unlocked different fields. A lane is a node now, so which of
`events:` / `tracks:` / `strudel:` it may write is decided by what it extends — a question about the
project, not about one file.

## The two tiers of `project.yaml`

Mixing them up is what put `libraries_from` at the top level doing nothing: `project: {…}` holds the
song's settings, while `trackOrder` and `markers` are its siblings. `markers` itself is a free
timecode → label map, so there is nothing to offer inside it.

## Where nothing is offered, on purpose

`params:` is a free param-name → number map and `plugin:` is deliberately open, the engine owning its
shape. Offering field names in either would invent a vocabulary. The same holds inside a `chains.yaml`
section, where the keys are node NAMES — a project's own vocabulary, which the schema cannot know
and `hints.ts` supplies — and for a free-text value such as `extends`, where a list would read as
though those were the only allowed values.

`structFields()` in the CUE version returned `[]` for anything it had no branch for, so `ui:` offered
its fields but `project: {}` offered nothing at all. That is the bug the derivation fixes.

## Where every flavour's fields are offered at once

A clip, a curve and a rack each have several flavours, and which applies depends on a field
(`type`, `rack_type`, the source's extension) that may not be written yet — so the union of them is
offered. A video shape is the same case one level down. The widget fields are one flat set because
the per-type narrowing is a refinement rather than a union, so they come off the base object it
wraps.

## Takes, alternatives and placements

A take is a list of lists: `takes[0]` is a take, `takes[0].events[0]` is a placement. The editor
completes both, so setting one aside by hand is as writable as the lane itself.

An alternative is a module partial, so what it may say is what a module may say — plus a name, and
minus `extends` and the alternatives themselves. Derived, so the two cannot drift. The
`alternatives` list itself has no field vocabulary: its entries are positions, not names.

`events:` is a module field now, so a lane's placements are offered here rather than by a track
vocabulary of its own — which is the whole of what the `track` kind used to be for. Inside a
placement, `from`/`to` are the event's own window (the placement-level half of the material's pair)
and `warp` is whether this event plays the material's stretch map; `event status warp` writes it, and
the editor offers it because the completion is DERIVED from the schema.

## The fields that are gone, and why the list is shorter than it was

- `ir` and `nam` each named a file in a shared asset library. The library is gone — a module carries
  what it loads, in its own `assets/` — and the one that survived is a `params:` entry, because a
  `.nam` model is one of the plugin's controls (`moduleTypes.FILE_PARAMS`).
- `jsdsp` was a filename beside a `plugin: {type: internal, name: DSP Graph}` that said nothing about
  it. The TYPE says it now (`plugin: {type: jsdsp}`) and the file is `jsdsp.ts` in the module's
  folder.
- `track` sat beside `channel` until an input's landing place became the chain's business: a shared
  `io/IN` module has one node per physical input and no project to name a track in.
- `docs` and `todos` are gone with the Docs panel that was their only reader. A note is a doc module
  on the graph now, and `content` is its text (`packages/song/docs/docModules.md`).
- `tracks:` at the top of a `chains.yaml` stays gone — a lane is a module and lives in `modules:`.
  `positions:` is the pins: where dragged nodes sit, cosmetic and hand-editable like the rest.

## The order of the module's fields

`alternatives` and `alternative` come last because they are the one pair that is ABOUT the fields
above rather than one of them. `status` is last and outside `MODULE_FIELDS`, so an alternative cannot
restate it — it is the one field that says nothing about what the module does or how it sounds.
