# Binary files: a ref in the text, the bytes in a store

A workspace holds audio, presets, amp models and images beside its YAML. They travel through the same
relay as everything else (`syncRelay.md`), but their bytes do not: an op carries a REF, and the bytes go
through a content-addressed store beside the relay, `/api/sync/blobs` (`../blobStore.ts`). The ref is
`@studio/live-sync`'s `blobRef` (`../../live-sync/src/blob.ts`); the capture that makes it is
`../../file-service/docs/liveCapture.md`. Phase 7 of `../../../docs/live-sync-plan.md`.

## The ref IS the file's text

A binary file is a whole-text op whose text is its ref: a NUL byte, `st0fs-blob`, the sha256 of the
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

## Upload before send

A batch leaves a replica only once every blob it names is on the store: a HEAD, then a PUT when it is
missing. So a replica that receives a ref can always fetch its bytes. Batches still leave in the order
they were made, so one waiting for its upload holds back the ones after it. A failed upload is retried,
longer and longer, and never drops the batch. A batch re-sent after a reconnect asks again, and the
HEAD makes that cheap.

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

## Not done

- **No collection of unreferenced blobs.** A blob no room names any more stays in the store.
- **No partial or resumable transfer.** A transfer that fails starts again from the first byte.
- **A device joins only its own account's rooms.** The libraries' rooms are not reachable with a
  device token, so a desktop or a phone still keeps its bundled library.
- **Hashing at start.** Capture hashes every binary of a workspace when it starts: about 20 ms more on
  the library checkout (2,142 files, 71 MB), and about 0.4 s per gigabyte of takes read from the page
  cache, more from a cold disk. No hash is remembered across restarts.
