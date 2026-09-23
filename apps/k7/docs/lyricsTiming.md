# Timed lyrics from an LRC file

An LRC brings the song's lyrics TIMES, and nothing else. Its lines are matched against the sheet's
own, and each match gets its time written into the sheet as `{{MM:SS}}`, at the end of the line. Not
a word of the sheet changes: its spelling, its chords, its sections and its tablature stay exactly
as typed. With a reference track, the line being sung is then highlighted as the track plays, and a
tap on a timed line seeks there.

**"Add timed lyrics…"**, in the song's ⋮ menu, opens one popin
(`apps/k7/frontend/src/components/TimedLyricsDialog.tsx`): it takes an `.lrc` file or finds one on
LRCLIB, and shows the sheet beside the same sheet with its timecodes before anything is saved. The
song pipeline does the same on its own, with LRCLIB's best version of the song (`audio.md`).

## In the text, as `{{MM:SS}}`

The timecodes live IN the lyrics, where the person who writes them can see, move and fix them by
hand like any other word — rather than in a field beside the text that nothing on screen shows.
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

Songs timed before this kept their times in a field beside the text (`LyricTimings`). They still
play: with no `{{MM:SS}}` in the text, the player falls back to it. Timing such a song again writes
the codes into the text and clears the field, so the two can never disagree.

## Found on LRCLIB

"Find timed lyrics", in the song's ⋮ menu, looks it up on **LRCLIB** (lrclib.net), a free crowdsourced lyrics
database with a public API and no key. Musixmatch has better coverage but licenses synced lyrics
for money; the players' own lyric services (Spotify, NetEase, QQ) are unofficial endpoints that
break without notice and are against their terms.

The search runs from the backend (`apps/k7/backend/src/lrclib.ts`): LRCLIB asks clients for a
User-Agent, and a browser should not call a third party on the user's behalf. All it sends is the
song's artist and title, and the reference track's length when there is one. Only results with
synced lyrics are offered, nearest that length first — a live cut or a remaster can run a minute
longer and time every line wrong. A single result is imported at once; several are listed by album
and length to pick from.

LRCLIB's timings are crowdsourced and uneven, so the popin lets a person pick another version, or a
file, and see the result before it is saved; the pipeline only ever applies a version of THIS song
(its artist and title).

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

The popin says how many fetched lines found a line ("18 of 21 fetched lines found a line of the
lyrics") before « Add the timecodes » saves.
