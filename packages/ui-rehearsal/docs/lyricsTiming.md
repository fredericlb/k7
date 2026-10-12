# Timed lyrics from an LRC file

An LRC brings the song's lyrics TIMES, and nothing else. Its lines are matched against the sheet's
own, and each match gets the time it STARTS written into the sheet as `{{MM:SS.cc}}`, in front of
the line. Not a word of the sheet changes. With a reference track, the line being sung is then
highlighted as the track plays, and a tap on a timed line seeks there. The format and the matching
are `packages/lyrics/docs/timecodes.md`.

The song pipeline does it, right after the download and before the stems, with LRCLIB's best
version of the song ([audio.md](audio.md)) — which can also be LRCLIB saying the song is
instrumental. There is no screen of its own: the timecodes are text, so they are seen, typed, moved
and fixed in the lyrics editor like any other word — a second editor for one part of the same text
would be two places to fix one mistake.

The lyrics editor shows them as they are, with a line under it saying what they do; the sheet, once
saved, shows none of them and lights the lines they time.

## A tap starts a little before the line

A click on a line starts the track **a little before** its code: the Options panel's « lyrics lead »,
1 s unless changed (`src/hooks/useLyricsLead.ts`). A stamp is a person's tap and often lands on the
first word rather than before it, and a musician wants the beat that leads in. It is kept in the
browser rather than on the song, because it is a habit of whoever plays, not a property of the
recording. The highlight still follows the codes themselves.

A song may carry its times in a field beside the text (`LyricTimings`) instead. It still plays: with
no `{{MM:SS}}` in the text, the player falls back to it. Timing such a song again writes the codes
into the text and clears the field, so the two can never disagree.

## Found on LRCLIB

The pipeline looks the song up on **LRCLIB** (lrclib.net), a free crowdsourced lyrics database with
a public API and no key. Musixmatch has better coverage but licenses synced lyrics for money; the
players' own lyric services (Spotify, NetEase, QQ) are unofficial endpoints that break without
notice and are against their terms.

The search runs from the server (`packages/rehearsal-server/src/lrclib.ts`): LRCLIB asks clients
for a User-Agent, and a browser should not call a third party on the user's behalf. All it sends is
the song's artist and title, and the reference track's length when there is one. Only results with
synced lyrics are offered, nearest that length first — a live cut or a remaster can run a minute
longer and time every line wrong. The pipeline sends the track's length (the one its waveform
stores), and uses the first result that IS this song by this artist — not simply the first:
LRCLIB's top answer can be credited to a spelling of the artist nobody would type
(« Oasis/oasis »), with good versions of the song behind it.

LRCLIB's timings are crowdsourced and uneven, so only a version of THIS song (its artist and title)
is ever applied, and what it writes is plain text a hand can correct afterwards. When nothing
applies, the song simply has no times — marked « unmatched » — and nothing under the title says so:
the lyrics editor's hint is where timing a line by hand is explained.
