# A song's lyrics, looked up on LRCLIB

`src/media/lyricsQueue.ts` looks a song's lyrics up when it lands in the library — an upload, a
hunt's find, a track given to a songbook song — and when it is played with none. Who is due a
lookup and what one leaves behind are the library's rules (`packages/mediatek/docs/autoLyrics.md`).

## Played means read

The server cannot see a play, only a read: a `GET /file` or `/stream` of a song's audio is taken
as one. That covers every player that streams from here — the médiathèque, its mini player, the
songbook — without any of them saying so. A play sends many requests (Range, seeks), so a folder
looked at in the last ten minutes is not looked at again, and nothing is read from disk for it.

## One at a time, and only when sure

Lookups run one after another, a second apart: an album uploaded is a dozen songs, and LRCLIB is a
free service asking for restraint. Nobody reviews an unattended lookup, so it takes a record only
when its length is within five seconds of the master's (`pickRecord`,
`packages/rehearsal-server/src/lrclib.ts`) — or, for a file whose length cannot be read, when the
artist and title are the same words. Timed lyrics are preferred; plain ones are kept when nothing
timed fits, since the songbook shows them all the same.

## Off where it must be

A test run never asks LRCLIB, and `STUDIO_LYRICS_LOOKUP=off` turns the lookups off for a
deployment that must not call out.
