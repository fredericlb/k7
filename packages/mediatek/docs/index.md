# The index — extended notes

## The filesystem is the index

There is no database. That is not an omission to be corrected later; it is the same
choice the rest of this repo already made, and reversing it would cost more than it buys.

- **There is no SQL anywhere in studio.** Grist is the only database, and it is hosted —
  precisely what the mediatek is not.
- **sqlite would be a native dependency inside a package that gets esbuild-bundled into a
  Tauri sidecar.** The file service is bundled to a single `.mjs` run by a vendored Node
  (`scripts/build-engine.mjs`). A `.node` binary in that closure is exactly the class of
  problem that packaging avoids.
- Every derived thing here is already a cache behind a change token. `workspace.ts`'s
  `revision()` is the same shape: a walk producing count + newest mtime.

So: a walk produces the listing, a token says when to walk again, and one JSON file makes
a restart cheap.

## Why the token is per family

`familyRevision()` is computed for `morceaux`, `samples` and `modules` separately.

One token for the whole library would mean importing a track invalidates the module list,
and the families move at completely different rates — a sample pack is dropped in once and
never touched, modules get edited all afternoon. A shared token would make the quiet
families pay for the busy one on every poll.

## Two ingredients, because neither is enough

Count plus newest mtime cannot see a change that preserves both: an in-place overwrite
inside the same filesystem-timestamp tick, with no file added or removed. That is exactly
the shape of "import a library, then list it".

So the token also carries a **mutation counter**, bumped by whatever did the writing —
the same pair `workspace.ts` uses, and for the same reason. `ingest.ts` bumps it only when
a file actually landed: an import that copied nothing changed nothing, and moving the
token would make every surface refetch a listing that is identical.

The counter is per process, which is the honest scope: it covers writes WE caused, and
the walk covers everything else — a file dropped in by hand, a `git pull`, another tool.

A content hash was considered and rejected for the same reason `workspace.ts` rejects it:
reading every file to decide whether to read every file costs more than the thing it
guards.

## When the walk gets slow

A full walk of a few thousand entries is milliseconds, and it only happens when the family
actually changed. If a library ever grows past that, the next step is a watcher
maintaining the in-memory listing with `index.json` as the warm start — not a database.

That escape hatch is written down here so the decision is a decision, not an assumption
nobody revisited.

## The cache is never load-bearing

`.cache/` is 100% derived and safe to delete at any moment. Both `warm()` and `persist()`
swallow every error: a library on a full or read-only disk still works, it just walks
again next time. Nothing reads `index.json` as truth — the revision is always recomputed
from disk first, and the cached listing is used only when it matches.
