# Timecodes in a lyric sheet, and matching an LRC to it

A sheet's lines can carry the instant they start, written IN the text as `{{MM:SS.cc}}` in front
of the line. This package reads them (`src/chords.ts`) and writes them from an LRC file
(`src/lrc.ts`). Where the LRC comes from and what the pages do with the times is
`packages/ui-rehearsal/docs/lyricsTiming.md`.

## In the text, as `{{MM:SS.cc}}`

The timecodes live IN the lyrics, where the person who writes them can see, move and fix them by
hand like any other word — rather than in a field beside the text that nothing on screen shows.

Double braces because a sheet's own syntax already owns the other brackets: `[C]` is an inline chord
and `[Chorus]` a section, and an LRC's native `[01:23.45]` would read as one or the other. Double
braces mean nothing else in a sheet. The hundredths are the LRC stamp's own: a line is a couple of
seconds long, so a code rounded to the second can seek into its first words. A hand may leave them
out (`{{MM:SS}}`); minutes take a third digit past 99.

A timecode is not text. The parser takes it off before it reads a line (`stripTimecodes`), so it
never shows on the sheet, never turns a lyric into a chord line, and never counts as a word when
lines are compared. The player reads each line's time off it (`timecodesByLine`); a code anywhere
on the line counts, and the first one wins.

It goes at the **start** of the line because that is the moment it names: LRCLIB stamps the instant
a line begins, and a tap on the line plays it from there. The cost is in the raw editor only: a chord
line above places each chord by its column, and the code pushes the words under it one code to the
right. The sheet is unaffected — the parser takes a code off together with the one space after it,
so the words sit in the columns they were typed in.

## Which line gets which time

`timeLyrics` (`src/lrc.ts`) writes an LRC's times into a sheet without changing a word of it: its
spelling, its chords, its sections and its tablature stay exactly as typed.

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
