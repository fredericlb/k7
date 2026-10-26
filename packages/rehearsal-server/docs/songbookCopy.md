# A songbook copied from the server

## A song copied from the server keeps its id

On a machine paired with a server (`../../file-hub/docs/syncRelay.md`), the songbook marks each song
with the same icons k7 uses for a workspace and the médiathèque, and lists the server's songs the
machine lacks, each with a **Download** (`../../ui-rehearsal/src/components/SongbookServerCopy.tsx`).
"On both" means the same song id on both sides. That is why a copy keeps the server's `Uid`: a
fresh id would make the copy look like a different song and offer the original for download again.
Content is not compared, so a song edited on one side after the copy still reads as synced.

Both sides keep the songbook in their library (`../../mediatek/docs/songbook.md`), so a copy is a
song FOLDER brought down whole by the library's own download (`../../mediatek/docs/serverCopy.md`):
the texts, the sheets, the master and the sidecar, with the song's id in it.

A copy is a SNAPSHOT, not a replica, so it is READ-ONLY where it landed. The copy records its
server in the sidecar's `songbook.origin`, and `../src/routes/songs.ts` refuses every write to it except the two that are the
machine's own: a star, and removing the song. If the copy could be edited, the machine would hold a
song that differs from the server's with nothing to bring the two together. The rehearsal rows have
no operation log that the workspaces' relay could order. So an edit is made on the server, and the
machine removes its copy and downloads it again. Removing a copy removes what the songbook added to
the local folder; the server keeps its song and offers it again.

## What crosses, and what does not

The server shows a device its whole songbook: every song is everyone's, so a device token, which
proves an account, is all it takes. Each song comes with the path of its folder, which is what the
machine asks the library to bring down.

The folder carries everything of the song, its bookkeeping included; only the origin is written on
the machine, once the folder is there. Favourites stay behind: a star belongs to the person who set
it. An instrumental the server's chain made beside the stems comes down with the folder, since it is
one of its files.
