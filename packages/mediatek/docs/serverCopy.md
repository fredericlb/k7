# A paired machine's library against its server's

A desktop paired with a server has a médiathèque of its own: a folder on its disk, seeded on first
run, that its own backend serves. The server has another. Each song and sample can therefore be on
the machine only, on the server only, or on both. The library screen says which, with the same
three icons k7's home page uses for a workspace, and offers a **Download** for what the server
alone holds (`../../ui-library/src/ServerCopy.tsx`).

## Matched by path

An entry's id is its library-relative path, the same on both volumes, so "on both" means "the same
path exists on both". Nothing compares bytes. A song edited on one side still reads as synced, and
that is accepted: comparing content would mean hashing every master on every look at the page,
the trade `sync.md` already refuses for the cache.

## The machine's backend asks, not the browser

The browser talks to its own backend (`../../../apps/k7/backend/src/media/routes/serverCopy.ts`), which
asks the server. The device token the pairing brought back (`../../file-hub/docs/syncRelay.md`) is
held by that backend and never reaches a page. The server answers a device on
`/api/sync/mediatek`: its ordinary library routes, gated by the device token instead of a session,
and limited to reads. A device that may sync the account's workspaces may read the library every
account reads anyway. It may not write it through that route.

## A download is the person's choice

Nothing comes down on its own. The same rule applies to workspaces: a server's library can be far
larger than a laptop's disk. A download copies every file the server's manifest lists at or under
the entry's path (a song is a folder, a sample a file) into the local library, and the local
listing picks it up on its next poll. Uploading the other way is not offered here.

## An album, or a playlist, in one gesture

A set list or an album is what someone wants on the laptop before a gig, and one click per song is
not a way to get it. So the download takes a LIST of paths, read against one manifest, and three
places hand it one: a folder's "Download all" in the server-only list, the songs tree's right-click
on an album or artist folder that is only partly here, and the playlist screen's button for the
lines that resolve to nothing here and to a song on the server (`../../ui-library/src/serverSets.ts`).

Each names the server-only SONGS, never the folder. Copying the album's folder whole would also
copy, over the local one, every song already here, and a song edited on this machine would lose its
edits to the server's copy without a word: matching by path cannot tell the two apart. A path in the
list the server lacks is named back in `missing` rather than failing the rest.

## Silent when there is nothing to say

An unpaired machine, and the server itself, answer `paired: false`, and the screen draws no icon.
A server that is unreachable draws none either, not a wrong one, and the page stays usable on what
is local.
