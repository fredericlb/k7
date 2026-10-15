# Binary files: a ref in the text, the bytes in a store

A workspace holds audio, presets, amp models and images beside its YAML. They travel through the same
relay as everything else (`syncRelay.md`), but their bytes do not: an op carries a REF, and the bytes go
through a content-addressed store beside the relay, `/api/sync/blobs` (`../blobStore.ts`). The ref is
`@studio/live-sync`'s `blobRef` (`../../live-sync/src/blob.ts`); the capture that makes it is
`../../file-service/docs/liveCapture.md`. Phase 7 of `../../../docs/live-sync-plan.md`.

## The ref IS the file's text

A binary file is a whole-text op whose text is its ref: a NUL byte, `k7fs-blob`, the sha256 of the
bytes and their length. Nothing that orders, settles or keeps ops had to learn a second kind of file.
The room holds the ref as the file's canonical text, a snapshot and a replica's confirmed text carry
it, and `was` is the `textHash` of the ref it replaced, so two machines replacing one take is a
conflict like any other whole text. History keeps the ref too (`history.md`).

A ref cannot be mistaken for a text file: capture reads a NUL byte as binary, so no text it sends can
start with one.

## Content-addressed, and verified on PUT

A blob is named by the sha256 of its bytes, so a name says exactly which bytes it means. Two files with
the same bytes are one blob, a rename sends nothing but a ref the store already holds, and sending a
blob twice is harmless. The store hashes every upload as it streams in and keeps it only when the hash
is the one in the URL. A replica checks the hash again on download. A name in the store therefore
always means its bytes, whoever uploaded them.

Each account has its own store, gated like the rooms: a device token or a hub secret. It lives in
`<account folder>/.sync-blobs/`, not under `.sync-relay/`, because every folder there is listed as a
room (`../roomsRoute.ts`). The libraries' account keeps its store beside the library folders, in a
dot-folder that is never taken for a library.

## The libraries' store is read by every account

Every replica follows the libraries' rooms read-only, as `@lib/<name>`, so every replica must fetch
their blobs. A request names that store by a path, `/api/sync/blobs/lib/<hash>`, the blob store's
twin of the relay's `@lib/` prefix: any device token or hub secret may HEAD or GET there, and only
the libraries' replica, holding the secret the hub made for that account, may PUT. A path rather
than a fallback from the caller's own store, so a HEAD never tells a replica that its OWN store
holds bytes that only the libraries' does. On the replica's side the workspace name decides it: a
fetch for a workspace named `@lib/…` reads `lib/` (`BlobTransfer.get`'s `workspace`,
`../../file-service/src/liveBlobTransfer.ts`).

## Upload before send

A batch leaves a replica only once every blob it names is on the store: a HEAD, then a PUT when it is
missing. So a replica that receives a ref can always fetch its bytes. Batches still leave in the order
they were made, so one waiting for its upload holds back the ones after it. A failed upload is retried,
longer and longer, and never drops the batch. A batch re-sent after a reconnect asks again, and the
HEAD makes that cheap.

## A transfer resumes where it stopped

A take is gigabytes and a phone's connection drops, so no transfer starts again from the first byte.

- **An upload** streams into a PARTIAL kept per hash (`partial/<hash>`). A body cut short leaves the
  bytes that arrived there, a HEAD of a blob the store lacks says how many
  (`x-k7fs-partial-length`), and the next PUT sends the rest with `?offset=N`. The whole is hashed
  before it is kept, prefix included, so a resumed blob is verified exactly as a whole one. An
  offset past what is kept is refused with the length to resume from; one short of it drops the
  bytes past it. One upload of a hash runs at a time.
- **A download** lands in a partial of the replica's cache, and a retry asks for the rest with
  `Range`, which the store answers `206`. A partial that is not a prefix of the blob fails the hash
  at the end and is dropped, so the attempt after it starts clean.

Retries keep their backoff; resuming only changes what each attempt sends.

## Orphans are collected; nothing history names ever is

A blob the store keeps is removed when no room of its account names it ANYWHERE — its current
files, its open conflicts, every segment and snapshot of its history — and it has not been written
or asked for in seven days (`../blobSweep.ts`). History keeps every ref forever, so the sweep never
takes the bytes of anything a restore could bring back: what it removes is an ORPHAN, an upload
whose batch was never ordered (a replica that died between the PUT and the batch, a batch refused).
The week is the margin for a batch still on its way, and a HEAD or a PUT of a blob the store holds
makes it young again, since a rename sends no bytes and names one the store already has. Partial
uploads go after the same week.

The sweep reads every file a room keeps for anything shaped like a ref, rather than parsing them:
a text that happens to spell one only keeps a blob longer. It runs a minute after the store first
serves an account in a process, then daily, for the accounts it has served: an account no replica
uses gains no orphan.

## A local copy of the bytes an op names

When capture sees a binary change, it copies the file into the replica's cache first and hashes the
COPY. The ref then names bytes that nothing in the workspace can change before they are uploaded: a
take overwritten a second later would otherwise upload bytes that do not match the ref already sent.
The copy is a clone where the file system allows it, so it costs nothing on APFS or Btrfs. It is dropped
once the store holds it.

A replica writing a ref takes the bytes from its cache or from a workspace file that already has them.
Otherwise the file is PENDING: the ledger knows its ref, the old bytes stay on disk until the new ones
arrive, and no sweep reads its absence as a removal. The list of pending files is kept beside the
cache, so a restart in the middle of a download does not send a removal either. Downloads run a few
at once.

A binary still being written waits until it has not moved for a second, so a take being recorded is
sent once, not every time the engine appends to it.

## Hashing at start is remembered

Capture knows a binary by its sha256, and hashing a workspace's takes costs about 0.4 s per
gigabyte from the page cache, more from a cold disk. So the hashes are kept across restarts, by
path and stamp (`../../file-service/docs/liveCapture.md`): an unchanged binary is not read again.
