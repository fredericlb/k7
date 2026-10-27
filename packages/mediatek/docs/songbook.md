# The songbook lives in song folders

A song's lyrics, tablature and sheet music are kept in its library folder, beside the master,
and the songbook is the list of library songs that carry at least one of them (`src/songbook.ts`).
The rehearsal recorder's songbook screens read and write them through `/api/mediatek/songbook`,
which is the only place their rules live.

```
songs/<artist>/<album>/<title>/
  original.flac        the master, its tags naming the song (docs/songs.md)
  lyrics.txt           the chord sheet, timecodes inline as {{MM:SS}}
  tabs.txt             the tablature
  chords.txt           lyrics with chords, typed by hand, kept apart from lyrics.txt for now
  sheets/score.pdf     one file per sheet, in the order the sidecar lists them
  song.yaml            uuid, source, variants, and the songbook: section
```

## One place for a song

A song in the songbook and a song in the library are one song: the reference track a band plays
along to is the master of the folder that holds the lyrics. Two stores would hold two copies of the
same names, linked by a path that breaks when either side moves. So:

- **Linking a library track moves the song into that track's folder** (`moveSongbook`): its texts,
  sheets and bookkeeping follow, and the folder it leaves is removed when it holds no audio. A
  target already holding another songbook song is refused, never merged.
- **Uploading a track makes it the master of the song's own folder** (`setSongbookMaster`), tagged
  with the song's names.
- **Unlinking leaves the audio where it is** (`detachSongbook`): the song moves to a folder of its
  own with no master. The library keeps every file it was given.
- **Deleting takes out what the songbook added** (`deleteSongbook`): the texts, the sheets and the
  bookkeeping. A master stays, an ordinary library song; a folder with no audio goes whole.

## The id is the sidecar's uuid, never the path

A song changes folder when it is linked or unlinked, and the songbook's URLs, its favourites (kept
per person by the rehearsal server) and a paired machine's copy all name it. `uuid:` in `song.yaml`
is what they name; the folder is found from the listing (`songbookFolder`).

## A song with no audio is named by its sidecar

A song typed into the songbook before any recording exists has no master, so no tags to carry its
title and artist. Until a master arrives, `title:` and `artist:` in the sidecar hold them, and the
scan reads them there (`scan.ts`). A master landing — by the songbook's upload or by the library's
own Add a song — writes them into its tags and drops them from the sidecar
(`sidecarAfterUpload`, `write.ts`). The folder such a song is filed in is the one an upload of the
same names would build, `songs/<artist>/Album inconnu/<title>`, followed by ` (2)`, ` (3)` when a
songbook song already holds it.

## Bookkeeping is a sidecar section

`songbook:` holds what the songbook needs about a song and the music does not: who created it, when,
the fetch pipeline's state, whether its lyrics were timed automatically, the instrumental's path,
the server a paired machine copied it from, and the sheets' order and names. It is edited through
the YAML document API (`parseDocument`), so a comment someone wrote in the sidecar survives every
write. A field cleared is removed, not left as an empty string.

## Listed by what it carries

A song is in the songbook when it has `lyrics.txt`, `tabs.txt`, `chords.txt` or a sheet. A text emptied in the
editor removes its file, so an emptied song leaves the list rather than showing a row with nothing
behind it. The listing's entries say so (`meta.lyrics`, `meta.tabs`, `meta.chords`, `meta.sheets`, with
`meta.owner`, `meta.origin`, `meta.createdAt`), so the songbook is one catalogue read.

Lyrics looked up on LRCLIB for a song that has a master and none land the same way, so a library
song joins the songbook on its own once its words are found ([autoLyrics.md](autoLyrics.md)).

## Everyone's

The songbook has no private songs: everything in the library is shared, and a song visible to some
accounts and not others has no place in a folder every account reads. Removing a song is an admin's
(`libraryGate.ts`), or the rehearsal server's own service token, which applies the songbook's rule
before calling — an admin, or anyone for a paired machine's copy.

## A copy is a folder

A paired machine copies a server's song by bringing its folder down whole — texts, sheets, master
and sidecar — then setting `songbook.origin` to the server, which makes it read-only there
(`../../rehearsal-server/docs/songbookCopy.md`).

## From the rehearsal store

A songbook still held in the rehearsal server's SQLite store (`Songs` rows, `sheets/`) moves here
once with `npx tsx scripts/migrateSongbook.ts --data <K7_DATA_DIR> --library <STUDIO_MEDIATEK>
[--dry-run]`, run from `packages/rehearsal-server`: a song whose track is a library file joins that
folder, the others get one of their own, timings stored beside the text are laid into it, and the
private flag is dropped. The store's rows are left as they were; a second run completes a song an
interrupted one left half-filed and changes nothing else.
