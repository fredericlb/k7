# What the editor offers, and where it gets it

Completion here is deliberately ignorant. `k7xCompletions` (and `yamlCompletions`, for the
médiathèque's YAML files) knows how to find the cursor in a document and how to write a value
back into it; it knows no field names and no module names at all. Those come from a
`YamlVocabulary` the caller supplies, so the editor cannot hold a table that drifts from a schema.
The type keeps its name: it is format-agnostic, `{ fieldsAt(path), valuesAt(path, field) }`.

There are three layers, and each answers a question the one below it cannot:

| layer | lives in | answers |
|---|---|---|
| the schema | `@studio/song-schema`'s `yaml/fields.ts` | which fields a `module.k7x` may carry, and which values a closed enum allows |
| the project | `vocabulary.ts`'s `projectValues` | names nothing could enumerate ahead of time — a graph's nodes, what a module may `extends` |
| the caller | a `YamlVocabulary` of its own | a file the project schemas have never heard of |

## The layer under the schema

`valuesAt("module", [], "extends")` returns `[]`, and that is right: a base ref is whatever
this machine's engine scanned plus whatever anybody wrote, and no Zod enum can hold it. So
`projectValues` has to pick the question up afterwards — handle the graph alone and return
`[]` for every other kind, and `extends` is the one reference field in the whole vocabulary
that completes against nothing at all.

It reads `hints.baseModules`, which the protocol carries and k7's backend fills from the same
scan cache the engine writes. In a project's NODE file (`nodes/<name>.k7x`) the `@engine` refs are
dropped from it: a node reaches a scanned plugin through the library module that gives it a face,
and one extending the raw ref shows no panel (`packages/song/docs/moduleNamespaces.md`). A
library's `module.k7x` is where an engine ref belongs, so there it is offered.

## The graph vocabulary is POSITIONAL

`graph.k7x` is the one project file whose values are almost entirely names the project
invented, and since it declares segments there are no field names left to key on: a key under
`tracks` or `modules` is a NODE's own name, and what follows it is a list of destinations. So
`projectValues` reads the key PATH rather than the field.

Three rules fall out of that, and each is a thing deliberately *not* offered:

- **a chain name is never a destination.** A bus is reached by naming the module it starts at,
  so offering the derived chain name as well would be two spellings for one arrow, and only one
  of them resolves.
- **a segment leaving a MODULE may also land on a track**, which is how a live input is wired:
  the input is the node the run starts at, and the track is where its signal arrives. Not
  offered under `tracks` — a track's signal never lands on another track.
- **`bypassed` lists modules and nothing else.** A track cannot be switched out of its own
  chain, and a sink has nothing to pass through.

With no hints at all the answer is an empty list rather than a guess: the editor mounts before
the first hints arrive, and empty means "free text", which is the honest answer then. A project
value may also only ever fill a field a schema left OPEN — a module file has its own `type`
and `io` enums and keeps them, so the graph vocabulary cannot spill into another kind of file.

## The third layer, and why the path cannot always say

`schemaVocabulary(path, hints)` is the adapter to a **studio project**: it maps a path to a
`FileKind` and asks `@studio/song-schema`. A playlist is not a project file, so `fileKindFor`
answers null and the vocabulary is empty — correctly, since a playlist's values are SONGS, and
knowing what a song listing looks like is the médiathèque's business rather than the compiler's.

So `YamlPane` takes an optional `vocabulary`, and the surface that holds the listing supplies
one. That is a seam rather than a special case: the alternative is teaching the project
schemas about a catalogue's shape, which would put the library's vocabulary inside the package
that must not depend on it.

The pane reads that vocabulary through a **ref**, not as a dependency of the memo that builds
the extension set: as a dependency, a songs listing polled every three seconds reconfigures the
language, vim and the keymap under the cursor — for a list only ever consulted when the
completion is asked for.

## Where the cursor sits in a .k7x file

`src/k7x/cursor.ts` is a scan of the text before the cursor, not a parse, because completion runs
on text the k7x parser refuses — an open bracket, a half-typed key. The scan only needs the
brackets still open: a call's `(` makes the cursor that key's value, `{` an object's keys until
`:`, `[` a list's items, and a word at a value position the head of a chain whose keys sit under
the value's key. A list item is a key AND a value until it is typed — `t(0)` is a chain and
`"pad"` a string — so `inSeqItem` offers a list's values and its items' keys at once.

A value is a string in k7x, so one is offered quoted, unless the cursor is already inside the
quotes, where it is offered bare from just after the opening one. Inside quotes the token runs
to the quote, so a value with spaces — a song's `AC-DC/Back in Black/Hells Bells` — completes
whole.

## Links follow the same SECTION rule

`k7x/entityLinks.ts` resolves a ctrl-clickable name the same way the vocabulary does. The graph
declares segments: the key above a value is itself an entity name, and no table of field names
can enumerate those, so the section answers instead — `tracks`, `modules`, `runs` and `bypassed`.

**Keys link there and nowhere else.** A module wired to nothing appears ONLY as a key
(`"eq_dj:vox": []`), so keys-are-never-links would leave it unreachable. Everywhere else a key is
a field name, and linking it would open the wrong half of the line. The links, like the ▶ gutter,
read the buffer's k7x tree (`k7xTree.md`).

## The médiathèque's YAML files

The médiathèque's store stays YAML (`song.yaml`, its playlists), and `YamlPane` keeps a YAML mode
for it: `yaml/language.ts`, `yaml/keyPath.ts`, `yaml/completions.ts`. Three things are only
true there.

**A `- ` item is a key AND a value.** `- song: x` is a mapping and `- x` is a scalar, and nothing
on the line decides which until the colon is typed. So `keyPosition` reports both (`inKey` and
`inSeqItem`), and the two vocabularies are offered together; the field a scalar there belongs to
is the key that introduced the LIST.

**A value may contain spaces.** The token being completed is matched by a word regex, which stops
at the first space — wrong for a song, whose folder is made from its tags. So when, and only
when, the offered values contain a space, the token is found **structurally** instead: the value
fragment on the line, past the `- ` of a sequence item, the `: ` of a mapping entry, or the
`[`/`{`/`,` of a flow collection. `validFor` widens with it, since a pattern that closed the list
on the first space would shut it halfway through a title.

**Quoting.** A value the user picked must never be the thing that stops the file parsing.
`quoteIfReserved` covers the characters YAML gives a meaning to at the start of a plain scalar,
plus a `: ` inside one. The **label** stays bare: the quotes are punctuation.

CodeMirror builds a state by parsing only the first 3000 characters under a 20 ms budget, and
keeps whatever it got, with no sign the tree is short. So `yaml/parseTree.ts` forces the parse
through the caret. A flow sequence past its first element — `items: [a, ` — is read as a key
position, because the line's last structural break is the comma; block form is what is covered.
