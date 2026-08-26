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

  The packaging CAN carry a native module — `onnxruntime-node` is marked `external`, then
  staged into `resources/node_modules/` where Node's ordinary resolution finds it
  (`stageNodeModule`) — so the cost is payable. It is still not worth paying, for a reason
  that has nothing to do with packaging: a separator earns a 166 MB model and a per-platform
  shared library because there is no other way to do the thing at all; an index earns
  nothing, because a walk plus a change token already produces it (below). And the mechanism
  does not solve macOS: nothing in this repo signs a third-party `.dylib`, so a notarised
  `.app` carrying one is unsolved.
- Every derived thing here is already a cache behind a change token. `workspace.ts`'s
  `revision()` is the same shape: a walk producing count + newest mtime.

So: a walk produces the listing, a token says when to walk again, and one JSON file makes
a restart cheap.

## A listing is entries, and a tree is a filesystem

A tree draws itself from the entry PATHS: `songs/Miles/Kind of Blue` puts `Miles` on screen
because something is filed under it. That works right up to the thing on disk that is **not
an entry**, and there are two of those:

- the folder `POST /folder` just made — "somewhere to drop into before the first file";
- a file dropped where no catalogue reaches (`samples/<kind>` lists packs, so a file
  beside them is nobody's entry).

Either would answer 200 and appear nowhere, which reads as the call having done nothing at all.
`scanUnlisted` is the other half: every path no entry accounts for, family-relative, beside the
entries in the same listing.

An ENTRY's folder is never descended into. A song and a module ARE folders and their
insides are theirs — so a module's own files travel **on the entry**, as `files`. A tree
drawing one needs both halves of that: what is actually in the folder (nodes, a
`.vstpreset`, a jsdsp source) and which of the three canonical names are missing, so it can
offer to create them. Drawing the three fixed rows alone would show neither file of a folder
dropped with two of its own, and read as having been flattened on the way in.

## What this volume does NOT hold, and why — two different reasons

**Modules and chains** live *with their families*. A module and a chain are authored in st0,
against a project where the plugin the module names is actually loaded, and committed to the
account's **library repository** — a git repository somebody owns, not a folder on this volume.
See `packages/song/docs/sharedFolders.md`.

**Playlists** hold no **bytes**. A playlist is pure reference — names of songs filed elsewhere —
so hosting one buys nothing, while costing the account a document it could not version alongside
the work it was written for. A set list lives in the workspace's `_playlists/`, and st0 is the
app that opens one (`packages/song/docs/playlists.md`).

## The words a browser needs live in `types.ts`

`RECORDINGS_DIR`, `CHAINS_FILE`, `NODES_DIR` and `SONG_FILE` sit in `types.ts` rather than in
`layout.ts` or `scan.ts`, where the rest of that shape lives. The reason is one-way: those two
open `node:fs`, and a surface reaching for the *name* of a file must not pull the filesystem in
with it. Both re-export the constants, so an importer may take them from either.

`CHAINS_FILE` is `graph.yaml` — literally the same name a st0 project uses at its root, and
deliberately so. A shared chain is not a different object from a project's whole topology: a chain
is a **folder** holding that file with a `nodes/` beside it, which is exactly what a project holds,
and the two differ only in a chain having no `project.yaml` and naming its ends `@in`/`@out`. One
name, so nothing downstream carries a second spelling.

## `files` and `assets` are two different questions

An entry that is a **folder** carries both, and they are not interchangeable.

`files` is the entry's own definition — its nodes, its panel, its shelf, a `.vstpreset`, a jsdsp
source. Exactly what is on disk: nothing more, because a row for a file that is not there lies
about the disk, and nothing less, because three fixed rows would hide whatever was actually
dropped in.

`assets` is the **material it loads** — samples, impulse responses, amp profiles. A tree draws
these as children and drops new ones in; nothing offers to *create* one, since they arrive as
bytes. They are `assets/`-relative POSIX paths and they are **nested**: a NAM pack is a folder per
amp, so flattening would invent a shape the disk has not got. A path ending in `/` is a folder
that holds nothing — the one thing no other path would mention.

## What an entry carries beyond its path

Three fields on `meta` are computed in `scanSongs` and each answers a question a consumer
cannot answer from the path alone:

- **`master`** — the playable file's *name* inside the folder. `path` is the folder, because a
  song *is* a folder with a sidecar, so without this a consumer that has to OPEN the audio (the
  moteur, which takes file paths) has nothing to open. Absent when the folder is catalogued but
  carries no audio yet.
- **`stems`** — has this song been separated, is there a `stems/` beside its master? The DJ desk
  asks, because a deck can only subtract an instrument from a record whose stems exist
  (`packages/song-schema/docs/stems.md`), and the browser shows it so a set can be prepared. It is read
  off the dirents already in hand — the folder, not its contents: descending would be a syscall
  per song for a fact the directory entry itself carries.
- **`bpm`** — detected at upload and then editable by hand. Surfaced on the entry because a
  surface lining a song up to a grid needs it, and re-reading the sidecar would be a second
  source of truth.

## Why the token is per family

`familyRevision()` is computed for each family separately — `songs` and `samples`.

One token for the whole library would mean importing a track invalidates the sample list, and
the families move at completely different rates — a sample pack is dropped in once and never
touched, songs arrive all afternoon. A shared token would make the quiet family pay for the busy
one on every poll.

Two families today, and the argument would hold at five. It is the reason to keep the shape rather
than collapse it into one token: the next family to arrive would have to reintroduce it, and the
poll it fixes is not a poll anybody watches until it is slow.

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

A content hash is rejected for the same reason `workspace.ts` rejects it: reading every
file to decide whether to read every file costs more than the thing it guards.

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
about it moves when the SCAN changes — so a listing written by an older build matches a
token computed by a newer one, and the cache goes on answering the old question. A scan
that learns a new rule (a folder that counts as an entry, say) changes nothing on disk, so
nothing asks for a re-walk and the stale answer outlives the fix.

Bump it whenever what the scan PRODUCES changes — a new field, a different rule about what
counts as an entry. A dropped index costs one walk, which is what the next section is about.

## Confinement, and the two paths a caller may not write

`safePath` (layout.ts) turns a mediatek-relative path into an absolute one inside the root.
A local library does not need it: the file service's own `safePath` confines to the workspace,
which puts the mediatek out of reach entirely. A **hosted** mediatek has no such wall — the path
in the request is the only thing between a caller and the disk — so the check lives here, where
both sides use it.

It is **lexical only**, deliberately. It runs on every byte served, and the tree it guards is one
the service itself writes; a symlink *into* it is something an operator did on purpose.

Containment is asked of `relative`, **not** of `startsWith`, and the two are not the same test.
`startsWith` compares *spellings*: a root written with forward slashes in `env.yaml` never matches
the backslashed path `resolve` produces, so every nested path is reported as escaping a library it
is plainly inside. `relative` normalises both sides and answers the question actually being
asked — is this under that.

`writablePath` adds the second half. Inside the root is not enough: two things are the library's
own and not content — `mediatek.yaml`, which says what the folder *is*, and `.cache/`, which is
derived. Writing there would let a caller poison an index or forge a cache's bookkeeping.
Everything else is allowed, **including paths in no family**: a library that refused unfamiliar
folders could never grow a third one.

## Moving an entry is one syscall, and revs both ends

`moveEntry` (write.ts) renames, and it does so for a folder as readily as for a file.

Composing the same thing from read + write + delete on the client has two faults this does not:
a folder cannot be read as bytes at all, and a failure between the write and the delete leaves a
duplicate. `renameSync` is one syscall on the same volume, so the tree is never in a state where
the entry exists twice or not at all.

**Both** ends are bumped. A move between families changes two listings, and revving only the
destination would leave the source's catalogue showing something that is no longer there.

Every write in that file goes in beside its target and is renamed into place, for the reason the
cache's downloads do: the moteur may be reading this tree, and a half-written `module.yaml` is a
project that will not compile.

## The cache is never load-bearing

`.cache/` is 100% derived and safe to delete at any moment. Both `warm()` and `persist()`
swallow every error: a library on a full or read-only disk still works, it just walks
again next time. Nothing reads `index.json` as truth — the revision is always recomputed
from disk first, and the cached listing is used only when it matches.
