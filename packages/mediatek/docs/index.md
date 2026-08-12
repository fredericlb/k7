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

  That last sentence is now half true, and saying so is cheaper than letting a reader
  discover it. `onnxruntime-node` arrived for stem separation and the packaging DID grow a
  way to carry a native module: marked `external`, then staged into
  `resources/node_modules/` where Node's ordinary resolution finds it
  (`stageNodeModule`). So the mechanism exists.

  It does not change the answer here, for a reason that has nothing to do with packaging.
  A separator earns a 166 MB model and a per-platform shared library because there is no
  other way to do the thing at all; an index earns nothing, because a walk plus a change
  token already produces it (below). The cost is now payable, and still not worth paying.
  What the mechanism does not solve is macOS: nothing in this repo signs a third-party
  `.dylib`, so a notarised `.app` carrying one is still unsolved.
- Every derived thing here is already a cache behind a change token. `workspace.ts`'s
  `revision()` is the same shape: a walk producing count + newest mtime.

So: a walk produces the listing, a token says when to walk again, and one JSON file makes
a restart cheap.

## A listing is entries, and a tree is a filesystem

A tree draws itself from the entry PATHS: `modules/audio/reverb` puts `audio` on screen
because something is filed under it. That works right up to the thing on disk that is **not
an entry**, and there are two of those:

- the folder `POST /folder` just made — "somewhere to drop into before the first file";
- a file dropped where no catalogue reaches (`modules/<type>` lists directories, so a file
  beside them is nobody's entry).

Both answered 200 and appeared nowhere, which reads as the call having done nothing at all.
`scanUnlisted` is the missing half: every path no entry accounts for, family-relative,
beside the entries in the same listing.

An ENTRY's folder is never descended into. A song and a module ARE folders and their
insides are theirs — so a module's own files travel **on the entry**, as `files`. A tree
drawing one needs both halves of that: what is actually in the folder (nodes, a
`.vstpreset`, a jsdsp source) and which of the three canonical names are missing, so it can
offer to create them. Drawing the three fixed rows alone meant a folder dropped with two
files of its own showed neither, and read as having been flattened on the way in.

## Why the token is per family

`familyRevision()` is computed for each family separately — `songs`, `samples`, `modules`,
`chains` and `playlists`.

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

## The index is versioned, because the token cannot see a code change

`INDEX_VERSION` sits in the persisted JSON and an index that does not carry the current one
is dropped unread.

The revision token tracks the **files**: count, newest mtime, a mutation counter. Nothing
about it moves when the SCAN changes — so a listing written by an older build matched a
token computed by a newer one, and the cache went on answering yesterday's question. That
is exactly what happened when the module scan learned about category folders: nothing on
disk had changed, so nothing asked for a re-walk, and a category kept coming back as a
module long after the code was right.

Bump it whenever what the scan PRODUCES changes — a new field, a different rule about what
counts as an entry. A dropped index costs one walk, which is what the next section is about.

## The cache is never load-bearing

`.cache/` is 100% derived and safe to delete at any moment. Both `warm()` and `persist()`
swallow every error: a library on a full or read-only disk still works, it just walks
again next time. Nothing reads `index.json` as truth — the revision is always recomputed
from disk first, and the cached listing is used only when it matches.
