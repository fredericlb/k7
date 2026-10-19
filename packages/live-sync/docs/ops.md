# A workspace edit as an operation

`@studio/live-sync` turns one file's change into what a replica replays: values set or deleted at key
paths for a `.k7x` file, the whole text otherwise. The plan it belongs to is
[live-sync-plan.md](../../../docs/live-sync-plan.md).

## The op is DERIVED from the file, never declared by the writer

About a hundred call sites write workspace files, through song, song-edit, commands, take-render and
the file service's own routes, and most of them never pass through `recordChange`. Asking each one to
describe its edit would be a hundred places to forget. So the op comes from the text before and after
(`fileOpFor` in `src/fileOp.ts`), whoever wrote it.

## Path ops only when they replay EXACTLY

`fileOpFor` sends path ops (`src/k7xOps.ts`) only if replaying them on `before` gives `after` byte for
byte. Otherwise it sends the whole text. A comment that changed, keys that moved, or a file a writer
reformatted all travel as text. That costs bandwidth, never correctness: a replica holding the same
`before` always ends up with the same file.

The replay is what makes that rule hold without any formatting knowledge. A changed value is spliced
in as its source was written; a new entry or list item, and a removal, go through the k7x document's
own edits, the very ones song's writers use. A replica holding the same text, running the same edits,
lands on the same bytes. Measured over every `.k7x` file of `demos/` and `k7-core`, edited the way the
writers edit a document (value edits, and keyed-list items edited, removed and added): no fallback,
no wrong replay (`src/k7xCorpus.test.ts`).

Any other file travels whole, whatever its format: a `.yaml` file a workspace still holds (`env.yaml`,
`commands.yaml`) is text like a `.md`.

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

A path op carries `was`, the k7x source of the value it replaced (null when the key was absent); for
a list item that value is the whole item. A whole text or a removal carries the previous text's
`textHash`. That is what lets the room notice an op made against a value that has moved since, and
set it aside rather than overwrite (`sync.md`). A hash is enough for a whole file, since nothing shows
its old text; a path op carries the value itself because that is what a conflict shows next to the
alternative. An op without `was` is applied unchecked: a seed, a first join.

## A value travels as its own k7x source

A `set` carries the value as k7x text, not as a JS value, so a timecode stays a string, a note keeps
its `t(0).d(1).k(60)` short form and an inline list stays inline. Printing the value again would
reformat what the op does not name, and the byte-for-byte rule would send the whole text instead.

## A file is a path that cannot leave the workspace

An op's `file` comes from another replica, and the server is one replica among others: whoever
writes it treats it as hostile. `src/path.ts` is the one rule: a relative POSIX path, no empty, `.`
or `..` segment, no backslash, no drive letter, no control character. The relay's parser
(`readToRelay`, which also checks every op's shape, kind by kind) and `Room.submit` refuse a batch
that breaks it, so a room never holds such a path. Each replica checks again where it writes, against
the resolved path (`packages/file-service/src/livePath.ts`), since a hostile server is exactly the
case where the relay's check did not run. The rule has no `node:` in it, so a browser may use it too.

## What it costs

The sender pays one parse of each side and the replay check. The floor is two parses, which is what
the largest generated UI panels cost; they are rarely edited by hand.

A `.k7x` file is not merged as lines: its path ops are its merge.

## Not here

A rename travels as a removal and a creation. Ordering, the merge of two whole texts, and the op kind
an older k7 sent (`yaml`, refused at hello) are `sync.md`. A binary file is not an op of its own: it
is a whole text whose text is a blob ref (`src/blob.ts`, `../../file-hub/docs/blobs.md`).
