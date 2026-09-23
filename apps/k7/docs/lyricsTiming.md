# Timed lyrics from an LRC file

**"Add timed lyrics…"**, in the song's ⋮ menu, opens one popin
(`apps/k7/frontend/src/components/TimedLyricsDialog.tsx`): it takes an `.lrc` file or finds one on
LRCLIB, and its lyrics become the song's — merged into the sheet that was there, which is shown
beside the result before anything is replaced. With a reference track, the line being sung is then
highlighted as the track plays, and a tap on a timed line seeks there.

One entry rather than two — a file and a search were separate menu items — because they are the same
job: getting an LRC. Which way it arrives is a detail of the popin, and what matters afterwards is
the merge, which is the same either way.

## Beside the text, never inside it

The timecodes are a separate field of the song (`LyricTimings`), not `[01:23.45]` tags written
into the lyrics. That bracket is already the chord sheet's own syntax — an inline chord `[C]`, a
section label `[Chorus]` — so tags in the text would be misread, and they would clutter the
editor where the lyrics are written by hand.

Each stored timecode keeps the **normalised text** of its line as well as its line index. On
display the stored lines are aligned back onto the lyrics as they are now, by exact text, in
order: editing a line costs that line its time, and adding or removing lines around it costs
nothing else. No step has to remember to update timecodes when the lyrics are saved.

## Found on LRCLIB, on request

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

It is a button, never a background job: LRCLIB's timings are crowdsourced and uneven, so a person
decides when to fetch and which version fits. Whatever is picked goes through the same import as a
file, refusal included.

## The fetched lyrics are the truth

An LRC's lines become the song's lyric lines, in their order and each with its time — whether the
song had lyrics or not. What changes is what happens to a sheet that was already there
(`mergeLrc`, `packages/lyrics/src/merge.ts`):

| on the sheet | what becomes of it |
|---|---|
| lyrics and nothing else | replaced by the fetched lyrics, outright |
| chords over a lyric line, or inline `[C]` | moved onto the fetched words they were over, drawn the standard way — a line of chords above the lyric |
| a `[SECTION]` label | moved with the lyric line it stood before, to just before that line's fetched counterpart |
| a line of chords alone (`C**`, an intro) | the same |
| a block of tablature | kept whole, and placed the same way — as close as possible to where it was |
| anything else — a capo note, a credit | appended at the end, under `[OTHER CONTENT]` |

A sheet lyric line the fetched lyrics also sing is REPLACED by the fetched line — spelling,
punctuation and all. One the fetched lyrics do not have is dropped when it is only a variant of
theirs (35 % alike or more), since they are the truth; otherwise it is not lyrics at all and goes
under `[OTHER CONTENT]`. Nothing the sheet had is lost silently: its chords, if it had any, stay as a
line of their own where the words were.

A chorus the sheet wrote once and the LRC sings three times gets the chords of its first time on
each repeat (lines 90 % alike).

The popin never replaces a sheet blindly: it shows the sheet as it is beside what it would become —
« Song's lyrics » and « Result — from ⟨where from⟩ », the file's name or LRCLIB and the album of the
version picked, the headings kept in view while the lines scroll — and a sentence of what the merge
did ("18 of 21 of the sheet's lines found in the fetched lyrics · chords on 18 lines · 0 lines kept
under [OTHER CONTENT]"). « Replace the lyrics » saves the new text and its timings in one write;
« Back » offers the other versions again.

## How lines are matched

Only sung lines take part: chord lines, section labels, tablature and blanks are set aside, and
inline chords are removed from a line before it is compared. Both sides are compared without case,
accents or punctuation.

The two lists are **aligned in order** — an edit-distance alignment scoring each pair's similarity
(`fastest-levenshtein`) — rather than each line looking for its best match anywhere. A song repeats
its chorus, and a free search would pin every chorus to one occurrence; order is what tells the
second chorus from the first. For a merge two lines at least 50 % alike are the same line — lower
than the 70 % timing once asked for, since the time now comes from the LRC and a pair only decides
where the chords and sections go.

**Line breaks may differ.** A sheet often writes as one line what an LRC sings as two ("…an angry
heart, filled with cancers…"), or the other way round ("…get out of" / "bed in the morning"). The
alignment (`alignSpans`) may pair one sheet line with two fetched lines, or two with one: the texts
are joined, the chords moved across the joined text, and split back where the fetched line breaks.
A two-line pairing must match better than either line alone, or the second line is noise — a
"Capo 2" is not half of the first verse — and two sheet lines are joined only when nothing stood
between them.

**Chords follow their word.** Each chord is moved onto the fetched word it sat on (words 75 % alike),
keeping how far into the word it was; a word the fetched line no longer has falls back to the same
share of the way along the line. Two chords never touch: a later one moves right if it must.

A chord sheet as people type it is read loosely here: `C**` or `G.` is a chord with emphasis, so its
line is a chord line, where the renderer's stricter test would read it as lyrics.
