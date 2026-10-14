# A paired machine's library against its server's

A desktop paired with a server has a médiathèque of its own: a folder on its disk, seeded on first
run, that its own backend serves. The server has another. Each song and sample can therefore be on
the machine only, on the server only, or on both. The library screen says which, with the same
three icons st0's home page uses for a workspace, and offers a **Download** for what the server
alone holds (`../../ui-library/src/ServerCopy.tsx`).

## Matched by path

An entry's id is its library-relative path, the same on both volumes, so "on both" means "the same
path exists on both". Nothing compares bytes. A song edited on one side still reads as synced, and
that is accepted: comparing content would mean hashing every master on every look at the page,
the trade `sync.md` already refuses for the cache.

## The machine's backend asks, not the browser

The browser talks to its own backend (`../../../apps/st0/backend/src/media/routes/serverCopy.ts`), which
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

## Silent when there is nothing to say

An unpaired machine, and the server itself, answer `paired: false`, and the screen draws no icon.
A server that is unreachable draws none either, not a wrong one, and the page stays usable on what
is local.
