# A songbook copied from the server

## A song copied from the server keeps its id

On a machine paired with a server (`../../file-hub/docs/syncRelay.md`), the songbook marks each song
with the same icons k7 uses for a workspace and the médiathèque, and lists the server's songs the
machine lacks, each with a **Download** (`../../ui-rehearsal/src/components/SongbookServerCopy.tsx`).
"On both" means the same song id on both sides. That is why a copy keeps the server's `Uid`: a
fresh id would make the copy look like a different song and offer the original for download again.
Content is not compared, so a song edited on one side after the copy still reads as synced.

Both sides run the same store (`store.md`); a copy goes from one to the other over HTTP.

A copy is a SNAPSHOT, not a replica, so it is READ-ONLY where it landed. The copy records its
server in `Origin`, and `../src/routes/songs.ts` refuses every write to it except the two that are the
machine's own: a star, and removing the song. If the copy could be edited, the machine would hold a
song that differs from the server's with nothing to bring the two together. The rehearsal rows have
no operation log that the workspaces' relay could order. So an edit is made on the server, and the
machine removes its copy and downloads it again. Removing a copy deletes the local row only; the
server keeps its song and offers it again.

## What crosses, and what does not

The server shows a device what the person who paired it may see: the public songs and that
person's private ones. A device token proves an account, and an account can be shared. So the token
also names the person, the OIDC subject whose session minted it, and the private songs go to that
person alone. A token from before this rule names nobody and is shown public songs only.

A copy carries the song's text and its timings, its sheets, and its reference track and
instrumental. Those last two are médiathèque files, so they arrive through the library's own
download (`../../mediatek/docs/serverCopy.md`), and only when the machine lacks them. The owner
is the person signed in on the machine, and the copy stays as private as the original. The
auto-fetch pipeline's state and favourites stay behind: the pipeline's jobs ran on the server, and
a star belongs to the person who set it. Everything is fetched before anything is written, so a
failed download leaves nothing half there.
