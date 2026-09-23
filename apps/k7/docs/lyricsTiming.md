# Timed lyrics from an LRC file

**"Add timed lyrics…"**, in the song's ⋮ menu, opens one popin
(`apps/k7/frontend/src/components/TimedLyricsDialog.tsx`): it takes an `.lrc` file or finds one on
LRCLIB, pairs its lines with the song's, and lets a hand finish the pairing. With a reference track,
the line being sung is then highlighted as the track plays, and a tap on a timed line seeks there.

One entry rather than two — a file and a search were separate menu items — because they are the same
job: getting an LRC. Which way it arrives is a detail of the popin, and what matters afterwards is
the pairing, which is the same either way.

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

## Two ways an LRC lands

- **The song has no lyrics**: the LRC's lines become the lyrics, each with its time.
- **The song has lyrics**: they are left untouched, and only the lines the LRC matches get a time.
  A line only the lyrics have (an ad-lib, a spoken part) stays untimed.

## How lines are matched

Only sung lines take part: chord lines, section labels and blanks are skipped, and inline chords are
removed from a line before it is compared. Both sides are compared without case, accents or
punctuation.

The two lists are **aligned in order** — an edit-distance alignment scoring each pair's similarity
(`fastest-levenshtein`) — rather than each lyric line looking for its best match anywhere. A song
repeats its chorus, and a free search would pin every chorus to one occurrence; order is what tells
the second chorus from the first. Two lines at least 70 % alike are the same line: that absorbs a
typo or "gonna" / "going to" without pairing two different lines.

**Nothing is refused for matching badly.** The popin says how many lines paired — "3 of 12" — and
shows both sides so the rest can be paired by hand: the song's lines on the left with their
timecode, the file's on the right. Each column is **headed** with what it is — « Song's lyrics »
and « Fetched — ⟨where from⟩ », the file's name or LRCLIB and the album of the version picked — and
the headings stay in view while the lines scroll, since a long song leaves nothing else on screen
to tell two columns of lyrics apart. Click one of the song's lines, then its fetched line to pair
them; click a paired line to undo it. One LRC line answers for one lyric line, so giving it to another takes it
back from the first. Only a file with no timed line at all is refused, because there is nothing in
it to pair.

Refusing a poor match was right while the automatic pass was the only pass: wrong times on lines
that look right are worse than none. A hand that can fix them on the spot makes the refusal a
wall in front of the very case it was protecting — a live version whose verses are all there, an
ad-lib apart.
