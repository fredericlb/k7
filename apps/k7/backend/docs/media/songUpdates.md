# Songs that follow their server

On a phone, a song of the paired server is consulted through the forward and copied down in the
background (`packages/mediatek/docs/serverCopy.md`). Once here, it **follows** the server: this backend
keeps it in step on its own (`src/media/serverSongs/updates.ts`). The page only watches.

## Choices

- **A sidecar per song, holding the server's rows.** `.synced.json` in the song's folder records which
  server, at which songs revision, and the `(path, bytes, mtime)` that server listed for it
  (`packages/mediatek/src/synced.ts`). Dot-named, so the manifest walk, the scan and the change token
  never see it. Only the OWNER's rows are compared with the owner's next manifest; a local stat never
  enters (`packages/mediatek/docs/sync.md`).
- **Following is asked for, not inferred.** A download carries `follow: true` from a page that edits on
  the server (the phone). The tray's downloads do not: a song edited on the tray would otherwise be
  overwritten by the server's next change. A song with no sidecar is never touched by the check.
- **The backend runs it, not a page.** A check needs no page open and survives a reload: it starts
  fifteen seconds after the backend listens, then every thirty minutes. `POST /api/sync/library/check`
  asks for one now.
- **The revision first, the manifest once.** The server's songs token is compared with every
  sidecar's; equal, the check stops there for one small GET. Otherwise one songs manifest is read and
  every followed song diffed against its sidecar. The songs found unchanged are stamped with the new
  token, so the next check stops at the revision again.
- **A refresh copies what changed and removes what the server removed** — the files its sidecar listed
  that the server no longer lists. A file the sidecar never listed is not this check's to remove.
- **A song the server removed or renamed is kept**, its sidecar dropped: it becomes this machine's
  alone, and the placement reads it as "on this machine only". Deleting a musician's copy because a
  server lost it would destroy the one copy left.
- **One copy of a song at a time.** A page's download and the check's refresh of the same path wait on
  each other, so two writers never interleave in one folder.
- **The jobs are a list the page mirrors.** `GET /api/sync/library/jobs` answers the check and each
  refresh, a finished one kept six seconds; each run has its own key, so the page tells a new run from
  one it already saw end (`apps/k7/frontend/src/components/SongSyncDownloads.tsx`).
- **No storage cap, no eviction.** Every song consulted stays on the phone until somebody removes it.
  A cap would have to choose which rehearsal's songs go, and nothing here knows that yet.
