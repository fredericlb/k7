# live-sync: edits as operations

A workspace lives on the server and on every device that opens it: a desktop, a phone, the file
service behind the browser. `packages/live-sync` defines how an edit travels between them — as an
**operation** on a key path when one can express it, as a whole text otherwise — and the **order**
in which every replica applies them. The server's room assigns that order; its log is the
workspace's history. There is no merge of two whole files: a conflicting late edit is set aside,
never lost and never interleaved with conflict markers.

The package has no `node:` import. Its users are the hub's relay (`packages/file-hub/syncRelay.ts`),
the file service's capture and link (`packages/file-service/src/liveSync.ts`, `liveCapture.ts`,
`liveRelay.ts`), and the browser's conflict view (`apps/k7/frontend/src/syncConflicts.ts`).

## Operations

From `packages/live-sync/src/ops.ts`:

```ts
type KeyPath = string[];
type YamlOp =
  | { op: "set"; path: KeyPath; yaml: string; was?: string | null; after?: string | null }
  | { op: "delete"; path: KeyPath; was?: string | null };
type K7xOp =
  | { op: "set"; path: KeyPath; k7x: string; was?: string | null; after?: string | null }
  | { op: "delete"; path: KeyPath; was?: string | null };
type FileOp =
  | { kind: "yaml"; file: string; ops: YamlOp[] }
  | { kind: "k7x"; file: string; ops: K7xOp[] }
  | { kind: "text"; file: string; text: string; was?: string | null }
  | { kind: "remove"; file: string; was?: string | null };
interface Batch { id; replica; local; ts; label; ops: FileOp[]; resolves?: string[]; ends?: true }
interface Sequenced { seq: number; batch: Batch; parked: Conflict[] }
```

- A **path never holds a list index.** Items of keyed lists are named by their key fields
  (`packages/live-sync/src/listKeys.ts`): events by `ref`+`start`, notes by `t`+`k`, curve points by
  `time`, takes by `ref`+`start`, comp spans by `from`, crossfades by `at`, automations by `param`,
  subchains by `id`. Two replicas inserting into one list therefore do not shift each other's edits.
- `was` is what the operation replaced: the value's source text for a path op, a `textHash` for a
  text or remove op. It is how the room tells a stale edit from a current one; there is no base
  revision number.
- A binary file is carried as a blob reference, `"\u0000k7fs-blob <sha256> <size>\n"`
  (`packages/live-sync/src/blob.ts`); its bytes go through the hub's blob store.
- Every `file` is a relative POSIX path that cannot climb out: no absolute path, drive letter,
  backslash, control character, empty, `.` or `..` segment (`packages/live-sync/src/path.ts`). An op
  comes from another replica and is untrusted.

## From an edit to operations

`fileOpFor(before, after)` in `packages/live-sync/src/fileOp.ts`:

1. YAML (`.yaml`, `.yml`): diff the two parsed documents (`packages/live-sync/src/yamlOps.ts`), first
   with keyed lists as item ops, then with each list as one value. The ops are kept **only if applying
   them to `before` reproduces `after` byte for byte**; a correct diff can still miss a comment or a
   key order, which is why the replay check exists.
2. k7x: the same two passes with `diffK7x`/`applyK7x` (`packages/live-sync/src/k7xOps.ts`), which
   splice a value's source verbatim.
3. Otherwise: one `text` op with the whole new text and the old text's hash; a deleted file is a
   `remove` op.

Because the writers in `@studio/song-edit` change one value and keep every other byte, almost every
edit made in k7 becomes a small path op.

## Ordering: the room

`Room` (`packages/live-sync/src/room.ts`) is one per workspace on the hub. `submit(batch)`:

- deduplicates by `batch.id` (a resent batch gets its original entry back);
- settles each file op against the current files (`settleFileOp`): a path op applies when the value
  at its path still equals its `was` (or already equals the target, which is skipped); a text op when
  the current text's hash is its `was`. A late whole text of a non-YAML file may still be merged by
  diff3 against a remembered base (`packages/live-sync/src/textMerge.ts`) if no region conflicts;
- **parks** what does not settle as a `Conflict` (`kept` holds the value that won), applies the
  rest, and appends the entry with `seq = head + 1`.

The hub writes each entry to the room's log before relaying it as `seq` to every socket of the room,
the sender included. A replica catching up gets `seed` (empty room), the missing `entries`, or a
`snapshot` when it is too far behind (the log keeps 2000 entries). Open conflicts are tracked by
`ConflictSet` (`packages/live-sync/src/conflicts.ts`); a later batch resolves them by id
(`resolves`), and the browser's conflict view lets the user take the parked version.

## Rebase: the replica

`Replica` (`packages/live-sync/src/replica.ts`) keeps the room's **confirmed** text and its own
**pending** batches. What a replica shows is the confirmed text with every pending op of that file
re-applied; ops that no longer apply are dropped from the view. `remote(entry)` advances the confirmed
state and forgets its own batch once sequenced; `adopt(head, files)` takes a snapshot and replays
pending batches on top; `unconfirmed()` is what to resend after a reconnect.

## The wire

`packages/live-sync/src/protocol.ts`, one JSON object per WebSocket frame, one socket per account
carrying all its workspaces:

| Direction | Message |
|---|---|
| replica → relay | `{ t: "hello", workspace, since }`, `{ t: "batch", workspace, batch }` |
| relay → replica | `{ t: "welcome", mode: "seed" \| "entries" \| "snapshot", head?, files?, conflicts? }`, `{ t: "seq", entry }`, `{ t: "error", error }` |

`parseToRelay` validates every frame field by field (`isBatch`, `isFileOp`): the relay trusts the
socket's authentication, never its payload. The endpoint is `WS /api/sync` on the hub
([file-hub](./37-file-hub.md)), or the paired server's `wss://<host>/api/sync`.

## Tests

- `packages/live-sync/src/converge.test.ts`: seeded random runs (many seeds × three replicas ×
  hundreds of steps) of YAML, markdown and keyed-note edits with late and interleaved delivery and
  replicas falling behind; every replica must end equal to the room with nothing unconfirmed.
- `packages/live-sync/src/corpus.test.ts` and `k7xCorpus.test.ts`: every YAML and k7x file under
  `demos/` and the library; each scalar edited and each keyed item edited, removed and added must give
  path ops that replay byte for byte.
- Unit tests beside each module (`room.test.ts`, `fileOp.test.ts`, `listOps.test.ts`,
  `textMerge.test.ts`, `path.test.ts`, `blob.test.ts`).
