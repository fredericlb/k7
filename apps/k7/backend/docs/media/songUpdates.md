# The songs a machine keeps from its server

On a machine — a phone, the tray — a song of the paired server is read and played through the
forward (`packages/mediatek/docs/serverCopy.md`), and a song of the machine's own goes up
([songUploads.md](songUploads.md)). What this backend keeps here on its own is what the account's
**favorites and practice lists** hold ([practice.md](practice.md)): it downloads those songs, keeps
them in step, and deletes the copies it brought once the lists let them go
(`src/media/serverSongs/updates.ts`, the plan in `listed.ts`). The page only watches.

## Choices

- **The lists decide, read from the server.** The account's lists are the one thing every device
  shares that says "I want this song at hand", so they are what a machine keeps. Each run reads both
  lists through the server's device doors (`/api/sync/favorites`, `/api/sync/practice`) with each
  account's token on that server, and the server's song listing. A song is listed when it or a folder
  above it is, the rule the pages sort by (`isListed`).
- **Nothing is decided on a list unread.** A list that fails, a token the server refuses, a listing
  that does not come: that server's run stops before anything is downloaded or deleted. The kept
  copy of the lists a page reads offline (`stale`) is never what this job goes by, and a machine signed
  in to no server runs nothing at all: no list, nothing kept, nothing deleted.
- **A listed song not here comes down**, following the server, its sidecar marked `kept: "lists"`.
- **A copy the lists brought goes once it has left both** — and only such a copy: one carrying the
  mark, from that server, whose files are all ones the server sent (`onlyServerFiles`). A song made
  here, uploaded from here, or downloaded by hand carries no mark and is never deleted: a person's
  own copy is not a cache. The folder is deleted whole, its derived files with it, and the album and
  artist folders left empty go too.
- **A download by hand clears the mark** (`by: "hand"`); a refresh after an edit (`refresh`) and the
  update check leave it as it was. So a copy someone asked for survives the lists, and one they never
  asked for does not.
- **Only the listed songs look for updates.** A copy off the lists, kept by hand, is the person's as
  it is: it is refreshed when its song page writes to the server, and again once it is on a list.
- **When it runs**: fifteen seconds after the backend listens, then every thirty minutes, with the
  update check; and as soon as a list changes through this machine's page, without the check, so a
  song starred comes down now. `POST /api/sync/library/check` asks for a full run. A run asked while
  one is going is run once more after it, so a change made meanwhile is not missed.
- **A sidecar per song, holding the server's rows.** `.synced.json` in the song's folder records which
  server, at which songs revision, the `(path, bytes, mtime)` that server listed for it, and why it is
  here (`packages/mediatek/src/synced.ts`). Dot-named, so the manifest walk, the scan and the change
  token never see it. Only the OWNER's rows are compared with the owner's next manifest; a local stat
  never enters (`packages/mediatek/docs/sync.md`).
- **The revision first, the manifest once.** The server's songs token is compared with every listed
  copy's sidecar; equal, the check stops there for one small GET. Otherwise one songs manifest is read
  and every listed copy diffed against its sidecar. The ones found unchanged are stamped with the new
  token, so the next check stops at the revision again.
- **A refresh copies what changed and removes what the server removed** — the files its sidecar listed
  that the server no longer lists. A file the sidecar never listed is not this check's to remove.
- **A song the server removed or renamed is kept**, its sidecar dropped and a `.left-server.json`
  written beside it: it becomes this machine's alone, the placement reads it as "on this machine
  only", and the upload never sends it back. Deleting a musician's copy because a server lost it
  would destroy the one copy left; sending it back would undo the deletion.
- **One copy of a song at a time.** A page's download, the check's refresh and the lists' deletion of
  the same path wait on each other, and the deletion reads the sidecar again once its turn comes, so
  a download by hand that landed first keeps the song.
- **The jobs are a list the page mirrors.** `GET /api/sync/library/jobs` answers the check and each
  song brought down, a finished one kept six seconds; each run has its own key, so the page tells a new
  run from one it already saw end (`apps/k7/frontend/src/components/SongSyncDownloads.tsx`). The check
  is listed only when a listed copy follows that server; a deletion is not a job.
