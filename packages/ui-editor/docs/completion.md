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

It reads `hints.baseModules` now, which the protocol has carried the whole time and l8's
backend has been filling from the same scan cache the engine writes.

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

## What is still not covered

A flow sequence past its first element — `bypassed: [a, ` — is read as a key position, because
the line's last structural break is the comma and there is no colon after it. The first element
(`bypassed: [a`) completes, since the break is then the `: `. Nobody has hit this: these files
are written in block form, and the block form is what was fixed.
