# Lyrics looked up unattended

A song with a master and no `lyrics.txt` is due a lyrics lookup (`src/autoLyrics.ts`); the backend
asks LRCLIB and hands the answer back here (`apps/k7/backend/docs/media/lyrics.md`). This module
holds the library's half: who is due, and what a lookup leaves behind.

## A hit makes a songbook song

Found lyrics are written to `lyrics.txt`, like any typed in the songbook, and the folder is given
a `uuid` if it had none: a song with lyrics IS a songbook song (`songbook.md`), so the lookup is
also how a library fills its songbook. Timed lyrics are stored with their codes inline and
`songbook.lyricsMatch: matched`, which is what the songbook's own LRCLIB timing writes.

## A miss is written down, in the sidecar

```yaml
lyricsSearch:
  at: 2026-10-26T14:00:00.000Z
  result: not-found        # or error, no-title, instrumental
```

The mark lives with the song rather than in a table of the backend: it travels with the folder to
a paired machine, survives a restart, and is gone with the song. A lookup that found nothing, an
unreachable service and a song with no title to ask for are all a miss, and **the next lookup waits
at least a week** (`LYRICS_RETRY_MS`): LRCLIB is crowdsourced, so a song missing today may be there
later, and asking on every play would ask a free service the same question all day.

**An instrumental is an answer, not a miss.** LRCLIB saying the recording has no lyrics ends the
lookups for that song, and sets `songbook.lyricsMatch: instrumental`.

A found lyrics file removes the mark.

## Never a K7 release

`songs/K7/` holds the band's own published mixes: nobody else's database knows their words.
