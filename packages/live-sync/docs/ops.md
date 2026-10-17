# A workspace edit as an operation

`@studio/live-sync` turns one file's change into what a replica replays: values set or deleted at key
paths for a YAML or a `.k7x` file, the whole text otherwise. The plan it belongs to is
[live-sync-plan.md](../../../docs/live-sync-plan.md).

## The op is DERIVED from the file, never declared by the writer

About a hundred call sites write workspace files, through song, song-edit, commands, take-render and
the file service's own routes, and most of them never pass through `recordChange`. Asking each one to
describe its edit would be a hundred places to forget. So the op comes from the text before and after
(`fileOpFor` in `src/fileOp.ts`), whoever wrote it.

## Path ops only when they replay EXACTLY

`fileOpFor` sends path ops only if replaying them on `before` gives `after` byte for byte. Otherwise
it sends the whole text. A comment that changed, keys that moved, or a file a writer reformatted on
first touch all travel as text. That costs bandwidth, never correctness: a replica holding the same
`before` always ends up with the same file.

Measured over every scalar of every YAML file in `demos/` and `k7-core` that is already in writer
format (11,777 edits made the way song's writers make them): no fallback and no wrong replay. Over
their keyed lists (16 of them, the first five items each edited, removed, and followed by an added
one: 90 edits), every edit travels as item ops and replays exactly (`src/corpus.test.ts`).

## A list is merged by its items' natural key, or not at all

No list item in a song carries an id, and an index moves with every insertion, so a path never holds
one: an edit landed by index during a concurrent insertion would change the wrong item. What song's
schema does give is a NATURAL key, the fields a surface already finds an item by. `src/listKeys.ts`
holds them, by the list's own map key:

| list | key | why |
|---|---|---|
| `events` | `ref`, `start` | a placement's id is its material and its start (`placementId`) |
| `notes` | `t`, `k` | the roll finds a note by its key and its onset |
| `points` | `time` | a drawn curve holds one value per position |
| `takes` | `ref`, `start` | a take is a material at a song position |
| `comp` | `from` | each span of a comp starts at its own position |
| `crossfades` | `at` | one crossfade per seam |
| `automations` | `param` | one curve drives a param |
| `subchains` | `id` | a subchain is linked to by its id |

The table is matched by name in every file, so the rule that makes it safe is in the list, not in the
file: a list is keyed only when every item is a map carrying at least one of its key fields, each a
scalar, and no two items share a key. An absent field is left out of the key, which is what names a
video activation (no `ref`) by its start. Any other list stays one value, and so does a keyed list
whose items were REORDERED: a move is not an item edit.

What stays a leaf on purpose: `steps`, whose order is the signal path; `alternatives`, which
`alternative:` may select by index, so a concurrent insertion would switch the sound; every list of
scalars or tuples (`markers`, `tags`, `trackOrder`). A map with any non-string key is a leaf too: a
path cannot name its entries reliably.

An item is a path segment of its own: `[t=1,k=60]`, `[ref="kick",start="1:1"]` — the key fields in
the table's order, each value as JSON for a string and as written for anything else. The segment is
read as an item only where the path meets a LIST; under a map it is an ordinary key, so a map key
spelled like one cannot be mistaken for an item. Nothing ever parses a segment: an op finds its item
by computing every item's segment and comparing.

The diff emits a removed item as a `delete` of its segment, an edit inside an item as ops under its
segment, and an added item as a `set` carrying `after`, the segment of the item before it (null:
first). Changing a key field is a removal and an addition. When the item the new one goes after is
gone, it goes last: any rule converges, since every replica applies the room's result.

When item ops do not replay byte for byte, the same edit is diffed again with every list one value,
and only then sent as a whole text.

## Every op names what it replaced

A path op carries `was`, the YAML source of the value it replaced (null when the key was absent); for
a list item that value is the whole item. A
whole text or a removal carries the previous text's `textHash`. That is what lets the room notice an
op made against a value that has moved since, and set it aside rather than overwrite
(`sync.md`). A hash is enough for a whole file, since nothing shows its old text; a path op carries
the value itself because that is what a conflict shows next to the alternative. An op without `was`
is applied unchecked: a seed, a first join.

## A file is a path that cannot leave the workspace

An op's `file` comes from another replica, and the server is one replica among others: whoever
writes it treats it as hostile. `src/path.ts` is the one rule: a relative POSIX path, no empty, `.`
or `..` segment, no backslash, no drive letter, no control character. The relay's parser
(`readToRelay`, which also checks every op's shape, kind by kind) and `Room.submit` refuse a batch
that breaks it, so a room never holds such a path. Each replica checks again where it writes, against
the resolved path (`packages/file-service/src/livePath.ts`), since a hostile server is exactly the
case where the relay's check did not run. The rule has no `node:` in it, so a browser may use it too.

## A value travels as its own YAML source

A `set` carries the value as YAML text, not as a JS value, so a timecode keeps its quotes and an
inline list stays inline. A value on one line is copied verbatim from the file. The replay SPLICES
such a value into the source range of the old one. Printing the whole document instead would
reformat what the op does not name: the `yaml` library pads every inline list it prints.

## What it costs

The sender pays one parse of each side and the replay check. On the library: 0.6 ms median per edit,
2.4 ms at the 95th percentile. The floor is two parses, which on the largest UI file (313 KB) is about
160 ms. Those files are generated panels, rarely edited by hand.

## A .k7x file

A `.k7x` file's change is a `k7x` op (`src/k7xOps.ts`): the same paths, the same item segments from
the same `LIST_KEYS`, the same rule that path ops go only when they replay byte for byte, the same
`was` checked the same way by the room. Only the values differ: they travel as k7x source, and a
conflict's `kept` is k7x source too.

The replay is what makes the byte-for-byte rule hold for k7x without any formatting knowledge. A
changed value is spliced in as its source was written; a new entry or list item, and a removal, go
through the k7x document's own edits — the very ones the YAML bridge writes with
(`packages/k7x/docs/bridge.md`). A replica holding the same text, running the same edits, lands on
the same bytes. Measured over the corpus converted to k7x and edited the way the bridge writes (2,355
value edits, 90 list-item edits): no fallback, no wrong replay (`src/k7xCorpus.test.ts`).

A `.k7x` file is not merged as lines either, for the reason a YAML one is not: its path ops are its
merge.

## Not here

A rename travels as a removal and a creation. Ordering, and the merge of two whole texts, is
`sync.md`. A binary file is not an op of its own: it is a whole text whose text is a blob ref
(`src/blob.ts`, `../../file-hub/docs/blobs.md`).
