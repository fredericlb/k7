# The set lists on the volume

`playlists/<name>.yaml`, at the root of the médiathèque. What a playlist SAYS is not defined here —
it is `@studio/song-schema/playlist`, one format with one parser. This page is what the volume does
with one.

## A root zone, not a family

`playlists/` sits beside `recordings/` and `library/` and is deliberately absent from `FAMILY_DIRS`.
A family is **scanned for bytes**: every entry it produces carries a size, an mtime and a payload,
and the index, the revision token and `MediatekEntry` are all shaped by that. A set list has no
payload — it is names of songs filed elsewhere — so a scan would produce entries whose every
byte-shaped field is a lie.

Hence its own listing (`listPlaylists`) and its own route, the way the capture zone has both. No
family walk reaches the folder, so nothing else could have listed it.

The zone **nests**: `playlists/live/repet.yaml` is the playlist `live/repet`. The walk is recursive
and the name is the path under the zone with the extension taken off, which is why a subfolder needs
no declaring.

## The file IS the playlist

There is no folder around one and no marker inside it — the extension is the whole rule, as it is in
a workspace. A song is a folder because it carries a master and a sidecar; a playlist carries
pointers, and a folder around it would be an empty box.

`playlistPath` turns a name into the volume path and refuses `.` and `..` **per segment**, before
`resolve` ever sees the string: `safePath` would catch an escape anyway, but a name is a value
somebody typed into a field and the refusal belongs where the field is.

## The listing says two things, and neither is load-bearing

`title:` for what a row shows, and the count. Without a title the name stands in.

A file that **does not parse is listed all the same**, with `ok: false`. It is on disk: a listing
that hid it would leave you unable to click the very thing that needs repairing. The count is 0
there, which is not the same fact as an empty `items:` — one is to be fixed, the other to be filled,
and the screen says them differently.

Newest first, so the set list you are working on is the one at the top.

## Creating is a route; writing is not

`createPlaylist` writes the **stub** rather than an empty file: the screen draws its right-hand pane
from the text, and an empty file would open on a parse failure for a playlist nobody has yet had the
chance to get wrong. It adds the extension when missing — the extension is what makes the file — and
**refuses a name already taken** rather than handing it back, since a "create" that quietly opened
somebody else's set list is how you edit the wrong one.

There is no route for READING or WRITING one: `GET /file` and `PUT /file` already serve any path on
this volume, and a second pair spelling `playlists` into its URLs would be two ways to write one
file. The autosave the screen runs on is built on the pair that exists.

## Resolving a line is somebody else's job

`parsePlaylist` keeps `song` verbatim, so a line means nothing until it is held against the songs
catalogue. That resolution is `playlistItems.ts` — pure, tested on its own, and **shared with st0**,
which resolves the same references against the same catalogue. Two copies of "path first, name
second" would diverge at the first case learned on one side only.
