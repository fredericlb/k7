# Timed lyrics from an LRC file

An LRC brings the song's lyrics TIMES, and nothing else. Its lines are matched against the sheet's
own, and each match gets its time written into the sheet as `{{MM:SS}}`, at the end of the line. Not
a word of the sheet changes: its spelling, its chords, its sections and its tablature stay exactly
as typed. With a reference track, the line being sung is then highlighted as the track plays, and a
tap on a timed line seeks there.

The song pipeline does it, as its last step, with LRCLIB's best version of the song (`audio.md`).
There is no screen of its own: the timecodes are text, so they are seen, typed, moved and fixed in
the lyrics editor like any other word — which is what replaced the timed-lyrics popin, a second
editor for one part of the same text.

## In the text, as `{{MM:SS}}`

The timecodes live IN the lyrics, where the person who writes them can see, move and fix them by
hand like any other word — rather than in a field beside the text that nothing on screen shows. The
lyrics editor shows them as they are, with a line under it saying what they do; the sheet, once
saved, shows none of them and lights the lines they time.
`{{MM:SS}}` because a sheet's own syntax already owns the other brackets: `[C]` is an inline chord
and `[Chorus]` a section, and an LRC's native `[01:23.45]` would read as one or the other. Double
braces mean nothing else in a sheet. Seconds are rounded down; minutes take a third digit past 99.

A timecode is not text. The parser takes it off before it reads a line (`stripTimecodes`,
`packages/lyrics/src/chords.ts`), so it never shows on the sheet, never turns a lyric into a chord
line, and never counts as a word when lines are compared. The player reads each line's time off it
(`timecodesByLine`); a code anywhere on the line counts, and the first one wins.

It goes at the **end** of the line, not the start, because a chord line above a lyric places each
chord by its column: a code in front of the words would push every word out from under its chord in
the editor.

A code marks when its line is sung **out**, not in. That is what LRCLIB's stamps turned out to be on
k7's tracks: seeking to one lands at the end of its line. So the player reads each line's start off
the timed line before it (`lineStarts`, `packages/lyrics/src/lrc.ts`), and the first timed line
starts one typical line (the median gap between codes) before its own code. A tap on a line plays it
from there, and the highlight moves to a line as it begins.

Songs timed before this kept their times in a field beside the text (`LyricTimings`). They still
play: with no `{{MM:SS}}` in the text, the player falls back to it. Timing such a song again writes
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
longer and time every line wrong. The first result is the one used.

LRCLIB's timings are crowdsourced and uneven, so only a version of THIS song (its artist and title)
is ever applied, and what it writes is plain text a hand can correct afterwards. When nothing
applies, the insert under the title says so, and how to time a line by hand.

## Which line gets which time

`timeLyrics` (`packages/lyrics/src/lrc.ts`):

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
