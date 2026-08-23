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

## The layer that was missing

`valuesAt("module", [], "extends")` returns `[]`, and that is right: a base ref is whatever
this machine's engine scanned plus whatever anybody wrote, and no Zod enum can hold it. The
mistake was that nothing picked the question up afterwards — `projectValues` handled
`graph.yaml` and returned `[]` for every other kind, so `extends:` was the one reference field
in the whole vocabulary that completed against nothing at all.

It reads `hints.baseModules` now, which the protocol has carried the whole time and st0's
backend has been filling from the same scan cache the engine writes.

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
parser moved into `@studio/song` when playlists became a workspace folder; the listing did not,
and that is exactly the line this paragraph is about.)

So `YamlPane` takes an optional `vocabulary`, and the surface that holds the listing supplies
one. That is a seam rather than a special case: the alternative was teaching the project
schemas about a catalogue's shape, which would put the library's vocabulary inside the package
that must not depend on it.

The pane reads that vocabulary through a **ref**. It used to be a dependency of the memo that
builds the extension set, which meant a songs listing polled every three seconds reconfigured
the language, vim and the keymap under the cursor — for a list only ever consulted when the
completion is asked for.

## Two things the cursor could not say

Both are in `keyPath.ts` / `completions.ts`, and both were found by trying to complete a
playlist, whose common line is a bare `- <song>`.

### A `- ` item is a key AND a value

`- song: x` is a mapping and `- x` is a scalar, and nothing on the line decides which until the
colon is typed. `keyPosition` called it a key, which is the useful answer for `clips:` and
`notes:` — sequences of mappings — and the wrong one for every sequence of scalars.

It is now reported as both (`inKey` and `inSeqItem`), and the two vocabularies are offered
together. The field a scalar there belongs to is the key that introduced the LIST, and the
mapping is the one above that — the rule `entityValues.ts` already reads documents by, where
`in: [melody, pad]` resolves like `track: melody`.

This also fixed `graph.yaml` written in block form. `bypassed:` with its modules on `- ` lines
below it offered the file's three section names, because that is what `fieldsAt([])` says and
nothing was asking for values.

### A value may contain spaces

The token being completed is matched by a word regex, which stops at the first space. That is
right for everything a project file names — refs, params, track ids — and wrong for a song,
whose folder is made from its tags: `AC-DC/Back in Black/Hells Bells` is one value. Picking it
after typing past a space replaced only the last word, splicing the ref into the middle of
itself.

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
keeps whatever it got. Reading that tree found a THIRD of an 8.5 kB `chains.yaml` and reported
no error at all — every link and every gutter mark past the cut simply went dark, which reads as
the editor having given up rather than as a truncated parse.

So `parseTree.ts` forces the parse: through the caret for completion, and over the whole
document for the walks that answer about all of it (`entityValues.ts`, `previewTriggers.ts`). It
falls back to the budgeted tree if even that times out — a short answer beats no answer, and the
caller has none better to give. The same budget is why a loaded CI runner once returned an empty
tree for a two-line file: the first parse in a cold worker builds the parse tables, and 20 ms
does not always cover that.

## Links follow the same SECTION rule

`entityLinks.ts` resolves a ctrl-clickable name the same way the vocabulary does. `chains.yaml`
used to spell its references as fields — `{ track: vo.jo }, { module: eq_dj:vox }` — so "which
fields link" was a table of field names. It declares segments now, the key above a value is
itself an entity name, and no table can enumerate those; the section answers instead.

**Keys link there and nowhere else.** A module wired to nothing appears ONLY as a key
(`eq_dj:vox: [ ]`), so keys-are-never-links would leave it unreachable. Everywhere else a key is
a field name, and linking it would open the wrong half of the line.

## What is still not covered

A flow sequence past its first element — `bypassed: [a, ` — is read as a key position, because
the line's last structural break is the comma and there is no colon after it. The first element
(`bypassed: [a`) completes, since the break is then the `: `. Nobody has hit this: these files
are written in block form, and the block form is what was fixed.
