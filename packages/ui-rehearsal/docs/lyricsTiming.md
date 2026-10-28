# Timed lyrics from an LRC file

An LRC brings a song's lyrics TIMES, and nothing else. Its lines are matched against the song's own
text, and each match gets the time it STARTS written into it as `{{MM:SS.cc}}`, in front of the
line. Not a word of the text changes. With a reference track, the line being sung is then
highlighted as the track plays, and a tap on a timed line seeks there. The format and the matching
are `packages/lyrics/docs/timecodes.md`.

The lyrics lookup does it, when a library song's words are found on LRCLIB
(`packages/mediatek/docs/autoLyrics.md`) — which can also be LRCLIB saying the song is
instrumental. There is no screen of its own: the timecodes are text, so they are seen, typed, moved
and fixed in the lyrics editor like any other word — a second editor for one part of the same text
would be two places to fix one mistake.

## A tap starts a little before the line

A click on a line starts the track **a little before** its code: the « lyrics lead », 1 s unless
changed (`src/hooks/useLyricsLead.ts`). A stamp is a person's tap and often lands on the first word
rather than before it, and a musician wants the beat that leads in. It is kept in the browser
rather than on the song, because it is a habit of whoever plays, not a property of the recording.
The highlight still follows the codes themselves.

## Found on LRCLIB

The lookup asks **LRCLIB** (lrclib.net), a free crowdsourced lyrics database with a public API and
no key. Musixmatch has better coverage but licenses synced lyrics for money; the players' own lyric
services (Spotify, NetEase, QQ) are unofficial endpoints that break without notice and are against
their terms.

The search runs from the server (`packages/rehearsal-server/src/lrclib.ts`): LRCLIB asks clients
for a User-Agent, and a browser should not call a third party on the user's behalf. All it sends is
the song's artist and title, and the track's length when there is one. Only results with synced
lyrics are offered, nearest that length first — a live cut or a remaster can run a minute longer and
time every line wrong. The caller sends the length its waveform stores, and uses the first result
that IS this song by this artist — not simply the first: LRCLIB's top answer can be credited to a
spelling of the artist nobody would type (« Oasis/oasis »), with good versions of the song behind
it.

LRCLIB's timings are crowdsourced and uneven, so only a version of THIS song (its artist and title)
is ever applied, and what it writes is plain text a hand can correct afterwards. When nothing
applies, the song simply has no times, and the lyrics editor's hint is where timing a line by hand
is explained.
