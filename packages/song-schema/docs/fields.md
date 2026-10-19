# The editor's field vocabulary

The rationale behind `packages/song-schema/src/yaml/fields.ts` and its test — the completions the
k7x editor offers, DERIVED from the Zod schemas rather than hand-kept.

## Why it is derived

A hand-kept table is a second statement of the schema, and two statements drift: a field the schema
accepts goes unoffered, or a field is offered in the tier where it does nothing. Deriving from the
one schema makes that impossible rather than unlikely, and each kind of file answers for itself,
which a single flat table cannot do. Every object gets its own fields, `project: {}` as much as
`ui:`.

## `fileKindFor` — by folder, not by extension

`modules/audio/cab/module.k7x` is a module whatever it is called, and so is `nodes/melody.k7x` — a
node is an ordinary module that happens to live in `nodes/`, LANES INCLUDED
(`packages/song/docs/trackModules.md`). There is no `tracks/` kind for exactly that reason: a chain
project's `tracks/<lane>.k7x` is a module file too, and `validate.ts` reads the folder the same way.

A chain project's `chains/<name>.k7x` is a kind of its own, `chain` — not `chains`, which is the
segments file under its older root name `chains.k7x`, and stays one inside a library's older
chain folder (`chains/<name>/graph.k7x`). Its keys are positional the way the editor's key path
is: the file's own at the top; under `steps` a node's (a module's fields plus `id`, `bypass`,
`vstpreset`, `mapping`), a lane item's `track` and an end step's `to`; under `steps.to` a link's;
and below a node's field, that module field's own vocabulary
(`packages/song/docs/chainFiles.md`).

There is no per-kind narrowing for a lane either. A lane is a node, so which of `events:` /
`tracks:` / `strudel:` it may write is decided by what it extends — a question about the project,
not about the one file this answers for.

## The two tiers of `project.k7x`

`project: {…}` holds the song's settings, while `trackOrder` and `markers` are its siblings. Mixing
the two up is what puts a field at the top level where nothing reads it. `markers` itself is a free
timecode → label map, so there is nothing to offer inside it.

## Where nothing is offered, on purpose

`params:` is a free param-name → number map and `plugin:` is deliberately open, the engine owning its
shape. Offering field names in either would invent a vocabulary. The same holds inside a `chains.k7x`
section, where the keys are node NAMES — a project's own vocabulary, which the schema cannot know
and `hints.ts` supplies — and for a free-text value such as `extends`, where a list would read as
though those were the only allowed values.

## Where every flavour's fields are offered at once

A clip, a curve and a rack each have several flavours, and which applies depends on a field
(`type`, `rack_type`, the source's extension) that may not be written yet — so the union of them is
offered. A video shape is the same case one level down. The widget fields are one flat set because
the per-type narrowing is a refinement rather than a union, so they come off the base object it
wraps.

## Alternatives and placements

An alternative is a module partial, so what it may say is what a module may say — plus a name, and
minus `extends` and the alternatives themselves. Derived, so the two cannot drift. The
`alternatives` list itself has no field vocabulary: its entries are positions, not names.

`events:` is a module field, so a lane's placements are offered here rather than by a track
vocabulary of its own. Inside a placement, `from`/`to` are the event's own window (the
placement-level half of the material's pair) and `warp` is whether this event plays the material's
stretch map; `event status warp` writes it, and
the editor offers it because the completion is DERIVED from the schema.

## The fields that are NOT offered, because they do not exist

- `ir` and a top-level `model`: there is no shared asset library, a module carries what it loads in
  its own `assets/`, and `model` is a `params:` entry, because an amp model is one of the plugin's
  controls (`moduleTypes.FILE_PARAMS`).
- `jsdsp`: a filename beside a `plugin:` block that says nothing about it is two statements that
  have to agree. The TYPE says it (`plugin: {type: jsdsp}`) and the file is `jsdsp.ts` in the
  module's folder.
- `track` beside `channel`: where an input lands is the chain's business, and a shared `io/IN`
  module has one node per physical input and no project to name a track in.
- `docs` and `todos`: a note is a doc module on the graph, and `content` is its text
  (`packages/song/docs/docModules.md`).
- `tracks:` at the top of a `chains.k7x` — a lane is a module and lives in `modules:`.
  `positions:` is the pins: where dragged nodes sit, cosmetic and hand-editable like the rest.

## The order of the module's fields

`alternatives` and `alternative` come last because they are the one pair that is ABOUT the fields
above rather than one of them. `status` comes after them, outside `MODULE_FIELDS`, so an alternative
cannot restate it — it is the one field that says nothing about what the module does or how it
sounds, only how the completions treat it (`packages/song/docs/moduleStatus.md`).
