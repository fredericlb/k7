# What the YAML editor offers, and where it gets it

Completion here is deliberately ignorant. `yamlCompletions` knows how to find the cursor in a
document and how to write a value back into it; it knows no field names and no module names at
all. Those come from a `YamlVocabulary` the caller supplies, so the editor cannot hold a table
that drifts from a schema.

There are three layers, and each answers a question the one below it cannot:

| layer | lives in | answers |
|---|---|---|
| the schema | `@studio/song`'s `yaml/fields.ts` | which fields a `module.yaml` may carry, and which values a closed enum allows |
| the project | `vocabulary.ts`'s `projectValues` | names nothing could enumerate ahead of time — a chain's nodes, what a module may `extends` |
| the caller | a `YamlVocabulary` of its own | a file the project schemas have never heard of |

## The layer under the schema

`valuesAt("module", [], "extends")` returns `[]`, and that is right: a base ref is whatever
this machine's engine scanned plus whatever anybody wrote, and no Zod enum can hold it. So
`projectValues` has to pick the question up afterwards — handle `graph.yaml` alone and return
`[]` for every other kind, and `extends:` is the one reference field in the whole vocabulary
that completes against nothing at all.

It reads `hints.baseModules`, which the protocol carries and st0's backend fills from the same
scan cache the engine writes. In a project's NODE file (`nodes/<name>.yaml`) the `@engine` refs are
dropped from it: a node reaches a scanned plugin through the library module that gives it a face,
and one extending the raw ref shows no panel (`packages/song/docs/moduleNamespaces.md`). A
library's `module.yaml` is where an engine ref belongs, so there it is offered.

## The chains vocabulary is POSITIONAL

`chains.yaml` is the one project file whose values are almost entirely names the project
invented, and since it declares segments there are no field names left to key on: a key under
`tracks:` or `modules:` is a NODE's own name, and what follows it is a list of destinations. So
`projectValues` reads the key PATH rather than the field.

Three rules fall out of that, and each is a thing deliberately *not* offered:

- **a chain name is never a destination.** A bus is reached by naming the module it starts at,
  so offering the derived chain name as well would be two spellings for one arrow, and only one
  of them resolves.
- **a segment leaving a MODULE may also land on a track**, which is how a live input is wired:
  the input is the node the run starts at, and the track is where its signal arrives. Not
  offered under `tracks:` — a track's signal never lands on another track.
- **`bypassed` lists modules and nothing else.** A track cannot be switched out of its own
  chain, and a sink has nothing to pass through.

With no hints at all the answer is an empty list rather than a guess: the editor mounts before
the first hints arrive, and empty means "free text", which is the honest answer then. A project
value may also only ever fill a field a schema left OPEN — a `module.yaml` has its own `type`
and `io` enums and keeps them, so the chain vocabulary cannot spill into another kind of file.

## The third layer, and why the path cannot always say

`schemaVocabulary(path, hints)` is the adapter to a **studio project**: it maps a path to a
`FileKind` and asks `@studio/song`. A playlist is not a project file, so `fileKindFor` answers
null and the vocabulary is empty — correctly, since a playlist's values are SONGS, and knowing
what a song listing looks like is the médiathèque's business rather than the compiler's. (The
parser lives in `@studio/song`, since a playlist is a workspace folder; the listing does not,
and that is exactly the line this paragraph is about.)

So `YamlPane` takes an optional `vocabulary`, and the surface that holds the listing supplies
one. That is a seam rather than a special case: the alternative is teaching the project
schemas about a catalogue's shape, which would put the library's vocabulary inside the package
that must not depend on it.

The pane reads that vocabulary through a **ref**, not as a dependency of the memo that builds
the extension set: as a dependency, a songs listing polled every three seconds reconfigures the
language, vim and the keymap under the cursor — for a list only ever consulted when the
completion is asked for.

## Two things the cursor could not say

Both are in `keyPath.ts` / `completions.ts`, and both show on a playlist, whose common line is a
bare `- <song>`.

### A `- ` item is a key AND a value

`- song: x` is a mapping and `- x` is a scalar, and nothing on the line decides which until the
colon is typed. Calling it a key is the useful answer for `clips:` and `notes:` — sequences of
mappings — and the wrong one for every sequence of scalars.

So `keyPosition` reports both (`inKey` and `inSeqItem`), and the two vocabularies are offered
together. The field a scalar there belongs to is the key that introduced the LIST, and the
mapping is the one above that — the rule `entityValues.ts` already reads documents by, where
`in: [melody, pad]` resolves like `track: melody`.

`graph.yaml` written in block form needs the same thing: `bypassed:` with its modules on `- `
lines below it would otherwise offer the file's three section names, because that is what
`fieldsAt([])` says when nothing asks for values.

### A value may contain spaces

The token being completed is matched by a word regex, which stops at the first space. That is
right for everything a project file names — refs, params, track ids — and wrong for a song,
whose folder is made from its tags: `AC-DC/Back in Black/Hells Bells` is one value. On that
token, picking a value after typing past a space replaces only the last word and splices the ref
into the middle of itself.

So when — and only when — the offered values contain a space, the token is found
**structurally** instead: the value fragment on the line, past the `- ` of a sequence item, the
`: ` of a mapping entry, or the `[`/`{`/`,` of a flow collection. Every other file keeps the
token it has always had, which is the point of making the rule conditional rather than
replacing the regex outright.

`validFor` widens with it. A pattern that closed the list on the first space would shut it
halfway through a title, which reads as the editor having given up.

## Quoting

A value the user picked must never be the thing that stops the file parsing. `quoteIfReserved`
covers the characters YAML gives a meaning to at the start of a plain scalar, plus a `: ` inside
one — so `@engine/de-rez` and a band called `-M-` both arrive quoted, and `plain/one` does not.

The **label** stays bare. The quotes are punctuation; showing them in the list would be showing
YAML rather than names.

## The parse budget, and why nothing here uses it

CodeMirror builds a state by parsing only the first 3000 characters under a 20 ms budget, and
keeps whatever it got. Reading that tree gets a THIRD of an 8.5 kB `chains.yaml` and no error at
all — every link and every gutter mark past the cut goes dark, which reads as the editor having
given up rather than as a truncated parse.

So `parseTree.ts` forces the parse: through the caret for completion, and over the whole
document for the walks that answer about all of it (`entityValues.ts`, `previewTriggers.ts`). It
falls back to the budgeted tree if even that times out — a short answer beats no answer, and the
caller has none better to give. The same budget is why a loaded CI runner can return an empty
tree even for a two-line file: the first parse in a cold worker builds the parse tables, and
20 ms does not always cover that.

## Links follow the same SECTION rule

`entityLinks.ts` resolves a ctrl-clickable name the same way the vocabulary does. `chains.yaml`
declares segments: the key above a value is itself an entity name, and no table of field names
can enumerate those, so the section answers instead.

**Keys link there and nowhere else.** A module wired to nothing appears ONLY as a key
(`eq_dj:vox: [ ]`), so keys-are-never-links would leave it unreachable. Everywhere else a key is
a field name, and linking it would open the wrong half of the line.

## What is still not covered

A flow sequence past its first element — `bypassed: [a, ` — is read as a key position, because
the line's last structural break is the comma and there is no colon after it. The first element
(`bypassed: [a`) completes, since the break is then the `: `. Nobody has hit this: these files
are written in block form, and block form is what is covered.

## The same vocabulary for a .k7x file

A `.k7x` file (`packages/k7x/docs/language.md`) is completed from the very `YamlVocabulary` a YAML
one is: `fileKindFor` reads `nodes/pad.k7x` as `nodes/pad.yaml`, so the schema's fields and the
project's values cannot differ between the two formats. What differs is only WHERE the cursor
sits, and that is `src/k7x/cursor.ts`.

It is a scan of the text before the cursor, not a parse, because completion runs on text the k7x
parser refuses — an open bracket, a half-typed key. The scan only needs the brackets still open: a
call's `(` makes the cursor that key's value, `{` an object's keys until `:`, `[` a list's items, and
a word at a value position the head of a chain whose keys sit under the value's key. It answers
the four things the YAML mode's `cursorContext` answers, list items included, so `inSeqItem`
offers a list's values and its items' keys at once, as `- ` does in YAML.

A value is a string in k7x, so one is offered quoted, unless the cursor is already inside the
quotes, where it is offered bare from just after the opening one.
