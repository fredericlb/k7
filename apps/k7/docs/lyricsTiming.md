# Timed lyrics from an LRC file

An LRC brings the song's lyrics TIMES, and nothing else. Its lines are matched against the sheet's
own, and each match gets the time it STARTS written into the sheet as `{{MM:SS.cc}}`, in front of the line. Not
a word of the sheet changes: its spelling, its chords, its sections and its tablature stay exactly
as typed. With a reference track, the line being sung is then highlighted as the track plays, and a
tap on a timed line seeks there.

The song pipeline does it, right after the download and before the stems, with LRCLIB's best
version of the song (`audio.md`) — which can also be LRCLIB saying the song is instrumental.
There is no screen of its own: the timecodes are text, so they are seen, typed, moved and fixed in
the lyrics editor like any other word — which is what replaced the timed-lyrics popin, a second
editor for one part of the same text.

## In the text, as `{{MM:SS.cc}}`

The timecodes live IN the lyrics, where the person who writes them can see, move and fix them by
hand like any other word — rather than in a field beside the text that nothing on screen shows. The
lyrics editor shows them as they are, with a line under it saying what they do; the sheet, once
saved, shows none of them and lights the lines they time.
Double braces because a sheet's own syntax already owns the other brackets: `[C]` is an inline chord
and `[Chorus]` a section, and an LRC's native `[01:23.45]` would read as one or the other. Double
braces mean nothing else in a sheet. The hundredths are the LRC stamp's own: a line is a couple of
seconds long, so a code rounded to the second can seek into its first words. A hand may leave them
out (`{{MM:SS}}`); minutes take a third digit past 99.

A timecode is not text. The parser takes it off before it reads a line (`stripTimecodes`,
`apps/k7/packages/lyrics/src/chords.ts`), so it never shows on the sheet, never turns a lyric into a chord
line, and never counts as a word when lines are compared. The player reads each line's time off it
(`timecodesByLine`); a code anywhere on the line counts, and the first one wins.

It goes at the **start** of the line because that is the moment it names: LRCLIB stamps the instant
a line begins, and a tap on the line plays it from there. The cost is in the raw editor only: a chord
line above places each chord by its column, and the code pushes the words under it one code to the
right. The sheet is unaffected — the parser takes a code off together with the one space after it,
so the words sit in the columns they were typed in.

A click on a line starts the track **a little before** its code: the Options panel's « lyrics lead »,
1 s unless changed (`apps/k7/frontend/src/hooks/useLyricsLead.ts`). A stamp is a person's tap and
often lands on the first word rather than before it, and a musician wants the beat that leads in.
It is kept in the browser rather than on the song, because it is a habit of whoever plays, not a
property of the recording. The highlight still follows the codes themselves.

A song may carry its times in a field beside the text (`LyricTimings`) instead. It still plays: with no `{{MM:SS}}` in the text, the player falls back to it. Timing such a song again writes
the codes into the text and clears the field, so the two can never disagree.

## Found on LRCLIB

The pipeline looks the song up on **LRCLIB** (lrclib.net), a free crowdsourced lyrics
database with a public API and no key. Musixmatch has better coverage but licenses synced lyrics
for money; the players' own lyric services (Spotify, NetEase, QQ) are unofficial endpoints that
break without notice and are against their terms.

The search runs from the backend (`apps/k7/backend/src/lrclib.ts`): LRCLIB asks clients for a
User-Agent, and a browser should not call a third party on the user's behalf. All it sends is the
song's artist and title, and the reference track's length when there is one. Only results with
synced lyrics are offered, nearest that length first — a live cut or a remaster can run a minute
longer and time every line wrong. The pipeline sends the track's length (the one its waveform
stores), and uses the first result that IS this song by this artist — not simply the first: LRCLIB's
top answer can be credited to a spelling of the artist nobody would type (« Oasis/oasis »), and
stopping there left a famous song « unmatched » with nineteen good versions behind it.

LRCLIB's timings are crowdsourced and uneven, so only a version of THIS song (its artist and title)
is ever applied, and what it writes is plain text a hand can correct afterwards. When nothing
applies, the song simply has no times, and nothing under the title says so: the lyrics editor's
hint is where timing a line by hand is explained.

## Which line gets which time

`timeLyrics` (`apps/k7/packages/lyrics/src/lrc.ts`):

- **Only sung lines are candidates.** Chord lines (a hand-typed `C**` included), tablature, section
  labels and blanks are never timed, and inline chords are taken off a line before it is compared.
  Both sides are compared without case, accents or punctuation.
- **Each fetched line goes to the closest sheet line — in order.** The two lists are aligned by an
  edit-distance alignment that scores each pair's similarity (`fastest-levenshtein`) and never
  crosses: the third fetched line can never land above the line the second went to. A song repeats
  its chorus, and a free search would pin every chorus to one occurrence; order is what tells the
  second chorus from the first. Below 50 % alike a line is not the same line, and is left untimed —
  an ad-lib, a spoken part, a note.
- **Line breaks may differ** (`alignSpans`). A sheet often writes as one line what an LRC sings as two
  ("…an angry heart, filled with cancers…"), or the other way round ("…get out of" / "bed in the
  morning"). One sheet line may take two fetched lines — it gets the FIRST one's time, which is when
  it starts — and two sheet lines one fetched line, whose time goes on the first. A two-line pairing
  must match better than either line alone, or the extra line is noise; two sheet lines are paired
  together only when nothing but chords stands between them.
- **Codes already in the text are replaced**, never piled up: timing a sheet twice gives the same text.
- **A song with no lyrics** gets the fetched lines themselves, each with its code.
