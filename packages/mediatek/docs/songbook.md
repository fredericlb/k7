# The songbook lives in song folders

A song's lyrics, tablature and sheet music are kept in its library folder, beside the master, and the
songbook is the list of library songs that carry at least one of them (`src/songbook.ts`). The
médiathèque's song page reads and writes them through `/api/mediatek/songbook`, which is the only
place their rules live.

```
songs/<artist>/<album>/<title>/
  original.flac        the master, its tags naming the song (docs/songs.md)
  lyrics.txt           the chord sheet, timecodes inline as {{MM:SS}}
  tabs.txt             the tablature
  chords.txt           lyrics with chords, typed by hand, timed from lyrics.txt
  sheets/score.pdf     one file per sheet, in the order the sidecar lists them
  song.yaml            uuid, source, variants, and the songbook: section
```

## One place for a song

A song in the songbook and a song in the library are one song: the reference track a band plays
along to is the master of the folder that holds the lyrics. Two stores would hold two copies of the
same names, linked by a path that breaks when either side moves. So:

- **A library song's own folder is ADOPTED** rather than a new one made (`createSongbook`'s
  `folder`): its texts and sheets land beside the master it already has.
- **Uploading a track makes it the master of the song's own folder** (`setSongbookMaster`), tagged
  with the song's names — the folder it was filed in was already the one an upload of those names
  builds.
- **A song that never got audio** keeps its names in its sidecar, so it is found again once a master
  lands (`songs.md`).

## The id is the sidecar's uuid, never the path

A song's folder is named by its tags, and a rename moves it; the songbook's URLs, its sheets and
every screen name it by the `uuid:` in `song.yaml` instead. The folder is found from the listing
(`songbookFolder`), so an id survives the song being re-tagged.

## A song with no audio is named by its sidecar

A song carrying chords before any recording exists has no master, so no tags to carry its title and
artist. Until a master arrives, `title:` and `artist:` in the sidecar hold them, and the scan reads
them there (`scan.ts`). A master landing — by the song page's upload or by the library's own Add a
song — writes them into its tags and drops them from the sidecar (`sidecarAfterUpload`, `write.ts`).
The folder such a song is filed in is the one an upload of the same names would build,
`songs/<artist>/Album inconnu/<title>`, followed by ` (2)`, ` (3)` when a songbook song already
holds it.

## Bookkeeping is a sidecar section

`songbook:` holds what the songbook needs about a song and the music does not: when it was created,
whether its lyrics were timed automatically, the instrumental's path, how its chords were timed, and
the sheets' order and names. It is edited through the YAML document API (`parseDocument`), so a
comment someone wrote in the sidecar survives every write. A field cleared is removed, not left as
an empty string.

## Listed by what it carries

A song is in the songbook when it has `lyrics.txt`, `tabs.txt`, `chords.txt` or a sheet. A text
emptied in the editor removes its file, so an emptied song leaves the list rather than showing a row
with nothing behind it. The catalogue's entries say so (`meta.lyrics`, `meta.tabs`, `meta.chords`,
`meta.sheets`, with `meta.owner`, `meta.createdAt`), so the library's listing is one read.

Lyrics looked up on LRCLIB for a song that has a master and none land the same way, so a library song
joins the songbook on its own once its words are found ([autoLyrics.md](autoLyrics.md)).

## The chords take the lyrics' times

The lyrics are what was found or typed as lyrics; the chords are a person's own sheet. Every write of
either — a hand edit, lyrics found — times the chords again (`timeChordsAt`): each sung line takes the
time of the lyrics line it matches, `@studio/lyrics`' `timeFromSheet`, the same matching that times
lyrics from an LRC. Here, at the one place both texts are written, and not in a screen, so no two
editors can time them differently. `songbook.chordsMatch` says how it went: `matched`, `unmatched`
when the lyrics had times and no line matched, absent when the lyrics carry no time to give. The
chords keep what was typed whenever nothing is placed.

## Everyone's

The songbook has no private songs: everything in the library is shared, and a song visible to some
accounts and not others has no place in a folder every account reads.

