# A paired machine's library against its server's

A machine paired with a server — the tray, a phone — has a médiathèque of its own: a folder on its
disk that its own backend serves. The server has another. Each song and sample can therefore be on
the machine only, on the server only, or on both. The library screen says which, with the same
icons k7's home page uses for a workspace, and offers a **Download** for what the server alone
holds (`../../ui-library/src/ServerCopy.tsx`). A song of the machine alone is waiting to go up:
the machine's backend sends every one ([songUploads.md](../../../apps/k7/backend/docs/media/songUploads.md)).

## Matched by path

An entry's id is its library-relative path, the same on both volumes, so "on both" means "the same
path exists on both". Nothing compares bytes. A song edited on one side still reads as synced, and
that is accepted: comparing content would mean hashing every master on every look at the page,
the trade `sync.md` already refuses for a manifest.

## The machine's backend asks, not the browser

The browser talks to its own backend (`../../../apps/k7/backend/src/media/routes/serverCopy.ts`), which
asks the server. The device token the pairing brought back (`../../file-hub/docs/syncRelay.md`) is
held by that backend and never reaches a page. The server answers a device on
`/api/sync/mediatek`: its ordinary library routes, gated by the device token instead of a session,
and limited to reads. A device that may sync the account's workspaces may read the library every
account reads anyway. It may not write it through that route.

## Only the lists' songs come down on their own

A machine reads its server's songs on demand, through the forward, and plays them from there
(`../../ui-library/docs/songSource.md`); opening one copies nothing. What comes down on its own is
what the account's **favorites and practice lists** hold: those are the songs a person said they want
at hand, and the lists are the account's, so every machine signed in to the server keeps the same
ones. The machine's backend keeps them here, downloads a song as it enters a list, and deletes the copy
once it has left both (`../../../apps/k7/backend/docs/media/songUpdates.md`). Everything else comes
down only by hand: a server's library can be far larger than a laptop's disk or a phone's, and a song
merely looked at is not one to fill it with. A download copies every file the server's manifest lists
at or under the entry's path (a song is a folder, a sample a file).

Its edits go to the server's version, never to the copy, so a copy refreshed from the server loses
nothing. Such a copy **follows** its server: the download asks for it (`follow`), the server's rows
for that song are kept in its folder, and while the song is on a list this machine's backend keeps it
in step on its own.

**A copy the lists brought is theirs; one downloaded by hand is the person's.** The sidecar of a song
the lists brought down says so (`kept: "lists"`), and only such a copy is deleted when the lists let
the song go. A download by hand — the cloud button, an album's or a playlist's — writes no mark, and
clears the mark of a copy the lists brought: someone asked for that song, and leaving a list is not
asking to lose it. A refresh after an edit is no download by hand (`refresh`), and leaves the mark as
it was. Nothing else is evicted, and there is no cap: which rehearsal's songs to drop is not a choice
this code can make.

## Whether the server answers

`GET /api/sync/library/status` is this backend's word on it: one ping of the server's device door,
bounded at five seconds and remembered fifteen, and every listing or download that reached the server
or failed to says as much as a ping. A page reads it to decide what may be edited. It is the backend's
because the backend is what calls the server: the page's own requests all go to its own backend.
The same ping answers whether the active server can take a moment being consolidated
(`packages/rehearsal-server/docs/momentShare.md`): it is keyed by the server, so two accounts saved on
one server share one answer.

## An album, or a playlist, in one gesture

A set list or an album is what someone wants on the laptop before a gig, and one click per song is
not a way to get it. So the download takes a LIST of paths, read against one manifest, and two
places hand it one: the songs tree's right-click on any row holding something only the server has —
an artist, an album, one song — and the playlist screen's button for the lines that resolve to
nothing here and to a song on the server (`../../ui-library/src/serverSets.ts`). One entry alone
comes down from the cloud button at the end of its own tree row.

Each names the server-only SONGS, never the folder. Copying the album's folder whole would also
copy, over the local one, every song already here, and a song edited on this machine would lose its
edits to the server's copy without a word: matching by path cannot tell the two apart. A path in the
list the server lacks is named back in `missing` rather than failing the rest.

## Silent when there is nothing to say

An unpaired machine, and the server itself, answer `paired: false`, and the screen draws no icon.
A server that has never answered draws none either, not a wrong one, and the page stays usable on
what is local.

**A server that answered once is not forgotten for being slow.** A few hundred songs from a busy
origin take seconds to list, so the backend waits up to twenty, and when the server does not answer
it serves the last listing it had of that family, marked `stale`; the page, likewise, keeps the last
placement it was given rather than clearing it: cleared, every server-only song would vanish from the
page each time the server is slow, and come back thirty seconds later.

**A song the server removed stays the machine's**, listed as on this machine only (`kept` in the
placement) rather than waiting to go up: sending it back would undo the server's deletion. A copy
that still follows the server but is no longer in its listing — off the lists, so no check has marked
it yet — is listed the same way, since the upload never sends a song with a sidecar.

**The last listing is kept on disk** (`.server-listings.json` at the library's root, dot-named so no
scan sees it), written only when the server's revision moved. A phone restarted in a tunnel still
shows the server's songs and which of them it holds; the ones it does not hold say they cannot be
opened until the server answers.
