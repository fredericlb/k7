# A workspace edit as an operation

`@studio/live-sync` turns one file's change into what a replica replays: values set or deleted at key
paths for a YAML file, the whole text otherwise. The plan it belongs to is
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

Measured over every scalar of every YAML file in `st0-library` that is already in writer format
(11,548 edits made the way song's writers make them): no fallback and no wrong replay.

## A list is a leaf

No list item in a song has a stable id. Placements, notes, curve points, takes and alternatives are
found by index after a lookup on a natural key, and that key moves with the item. A path holding an
index would land a concurrent edit on the wrong item, so the diff never descends into a list: changing
one note sends the whole `notes` list. Two edits to one list are therefore one collision, settled like
any other. Merging inside a list waits for items that carry an identity.

The same holds for a map with any non-string key: a path cannot name its entries reliably, so it is
a leaf.

## Every op names what it replaced

A path op carries `was`, the YAML source of the value it replaced (null when the key was absent). A
whole text or a removal carries the previous text's `textHash`. That is what lets the room notice an
op made against a value that has moved since, and set it aside rather than overwrite
(`sync.md`). A hash is enough for a whole file, since nothing shows its old text; a path op carries
the value itself because that is what a conflict shows next to the alternative. An op without `was`
is applied unchecked: a seed, a first join.

## A value travels as its own YAML source

A `set` carries the value as YAML text, not as a JS value, so a timecode keeps its quotes and an
inline list stays inline. A value on one line is copied verbatim from the file. The replay SPLICES
such a value into the source range of the old one. Printing the whole document instead would
reformat what the op does not name: the `yaml` library pads every inline list it prints.

## What it costs

The sender pays one parse of each side and the replay check. On the library: 0.6 ms median per edit,
2.4 ms at the 95th percentile. The floor is two parses, which on the largest UI file (313 KB) is about
160 ms. Those files are generated panels, rarely edited by hand.

## Not here

Binary files, renames (a removal and a creation), list merges, ordering, and the relay are the plan's
later phases.
