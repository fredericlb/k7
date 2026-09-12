# A reference track is a file in `_references/`

A **reference track** is a finished recording you listen against while you work — the mix
somebody else got right, the last bounce, the demo the singer sent. It lives under
`_references/` at the root of the workspace, at whatever depth you like:

```
<workspace>/_references/Steely Dan - Aja.flac
<workspace>/_references/kick-refs/Rumours.wav
```

## The file IS the entry

There is no sidecar, no `reference.yaml`, no line anywhere declaring one: **the folder and the
extension are the whole rule**. Upload a `.wav` there and it is a reference track; move it out
and it stops being one. That is deliberate and it is the same rule `_playlists/` follows
([playlistFile.md](playlistFile.md)) — a document whose only content is "this file exists"
is a second thing to keep in step with the disk, and it always loses.

What follows from it, and is the point: **nothing has to be imported**. A folder synced by
whatever you already use — a clone, a drop from the OS, a copy over ssh — is a listing that is
already right.

## `_references`, beside `_modules`, `_libraries` and `_playlists`

Same **kind** of folder, so same place and same rule: found by where it is, never by a line
declaring it (`@studio/song`'s `docs/sharedFolders.md`). A reference is not part of a project
and must not be: it is somebody else's record, it is not played by the engine, it is not
compiled, and it must never end up in a `ProjectDoc`. A workspace where each of four projects
kept its own copy of the same three albums is exactly what the shared root avoids.

It is at the workspace root for the second reason too: **what you listen against outlives the
project you were in**. You compare a mix to Aja on Tuesday and to the same file on Friday from
another song in the same repository.

## The extension list is what a BROWSER can be asked to decode

`REFERENCE_EXTS` is not "audio files" in general: it is the set an `<audio>` element has any
chance with, because the browser is what plays a reference — see
`apps/st0/frontend/docs/references.md` for why. A codec the browser refuses still fails, and
fails out loud on the element; the list only keeps the obvious non-audio out of the listing.

So a `.md` or a cover image beside the tracks is not one, and gets no row. A folder is somebody's
folder: refusing to list what we cannot play beats drawing a row that plays nothing.

## `referencePathOf` answers null rather than a path

An upload names its file, and a name is a place a `../` can hide. The service checks every path
it is handed (`safePath`), so this is not the guard that matters — it is the one that keeps a
browser from ever *offering* an upload the service will refuse, and it is pure, so it is tested
rather than reasoned about.
