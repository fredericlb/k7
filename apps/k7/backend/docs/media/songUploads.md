# Songs that go up to their server

A machine paired with a server sends it every song of its médiathèque the server lacks, on its own
(`src/media/serverSongs/uploads.ts`), so once a server is added, all of the machine's songs are
there, or waiting to be. The page lists them as waiting while they are (`waitingOf`,
`packages/ui-library/src/ServerCopy.tsx`). Samples and modules stay where they are.

## Choices

- **The backend runs it, not a page.** Thirty seconds after the backend listens, then every three
  minutes, and right after the update check `POST /api/sync/library/check` starts: nothing to keep
  open, and a server away for a day gets every song once it answers again. Each song is a job of the
  list the download manager mirrors (`kind: "upload"`, [songUpdates.md](songUpdates.md)).
- **Through the server's device door, as the person who paired.** Each file of the song's folder is
  a `PUT /api/mediatek/file` there (`../serverDoor.md`): the same write a page of that person makes,
  no route of its own to keep, and the token never reaches a page.
- **Then the song follows the server.** Once its files landed, the server's own rows are written in
  its sidecar, exactly as a download that follows: from there the server's version is the one
  edited, and this copy is kept in step ([songUpdates.md](songUpdates.md),
  `packages/ui-library/docs/songSource.md`). One version and copies of it need no merge.
- **What goes up**: a song with no sidecar that the server does not hold at that path. A song already
  there by path stays as it is on both sides: matching by path cannot tell a copy from a namesake,
  and overwriting the server's would lose whatever was done there.
- **A song the server removed is never sent back** (`.left-server.json`, written by the update check):
  the deletion was somebody's choice there.
- **Half sent is finished, not taken for the server's.** `.uploading.json` is written before the first
  file goes, so a song that is partly on the server is still this job's at the next run, which sends
  only the files whose size differs there, and removed once its sidecar is written.
- **One server takes a song**: the first one paired, the active one of the machine's account. A song
  follows one server only.
- **An uploaded song is the machine's to keep.** Its sidecar carries no `kept` mark, so leaving the
  account's lists never deletes it ([songUpdates.md](songUpdates.md)); only a copy the lists brought
  down is theirs to take back. And a copy they took back is gone from the disk, while the server still
  holds it by path: nothing is left to send.
- **Away, everything waits.** The server's manifest is read first; a server that does not answer
  stops the run before a file is sent, and one that stops answering mid-run stops it there.
