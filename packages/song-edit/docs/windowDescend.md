# The window DESCENT

`windowDescend.ts` moves a material's `from`/`to` down onto every placement of it. It is the
one-shot half of "a material describes the bytes, a placement describes the use": after it runs,
`clips/*.yaml` and `sequences/*.yaml` state no window and every event states its own. The script
that drives it is `scripts/migrateClipWindows.ts`; the rules and their tests live in the module.

## `kind` is required, not inferred

The two kinds of edge are not the same axis. A clip's bare number is SECONDS into a file; a
sequence's edge is a POSITION in the notes and has no other spelling (`SeqEdge`). Reading them with
one rule is exactly the confusion this migration exists to end, so `edgeBeats` takes the kind rather
than guessing it from the value's type.

An edge that cannot be read answers null: a half-typed timecode is left alone rather than guessed
at.

## Which edge wins

`narrowest` is the compiler's rule: the larger `from`, the smaller `to`, so an event can only ever
narrow what its material plays. What is written back is the WINNING edge's own spelling — both
levels accept the same two spellings, so there is no reason to convert one.

An edge only one side states is that side's. An edge neither states stays absent, which means "the
whole file", answered by whoever can measure it. When either side is unreadable the EVENT's edge is
kept: it is the one a person last wrote.

## Every list, not just the one playing

`descendWindows` walks `everyEventList`, which reaches the takes and each alternative's own events
and takes. A take missed here would play the whole file the day you swapped it back onto the lane,
which is the failure that would be found last.

Each placement has its resolved edges SET and its unresolved ones CLEARED, so a placement never
keeps an edge the resolution decided against.

## Unchanged files are answered unchanged

A file this has nothing to do to comes back byte-identical rather than re-serialised. `toString`
reflows, and a migration that rewrote every lane file in the project to no effect would bury its
own diff.

And every write goes through `quoteTimecodes` at that one choke point: `to: 3:1` unquoted is
sexagesimal in YAML 1.1 and would load as beat 181.
