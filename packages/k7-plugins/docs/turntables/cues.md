# A deck's cue points

Eight buttons under each waveform, **across its full width**. **Short press**: the playhead jumps
to the cue. **Long press** (1 s): the cue is set. White while empty, its colour once assigned.

Nothing flanks them. Eight targets a hand has to learn by position are better wide than boxed in,
and the nudge gesture lives in the **band** you drag ([waveform.md](waveform.md)).

The eight buttons are there **even with no song loaded**, simply greyed. A desk whose controls
appear and disappear with what is loaded is a desk that moves under the hands: the row would push
the title up and the strip down the moment a song lands, and the eight positions a hand is
learning would not be there to be learnt. Greyed says "not yet"; absent says "go and find it".

## The gesture, and where it lands exactly

The cue is set **at the instant the finger went down**, not at the instant the second elapses. A
DJ presses when they hear what they want to mark; asking them to hold a second longer would place
the cue a second late, every time — a cue to fix rather than a cue to use.

So the position is captured on `pointerdown` and only **used** if the press lasts. The timer
decides which of the two gestures happened; it never decides where.

The position read is the deck's **raw** needle, the last number the engine sent, and not the drawn
one the band scrolls with ([needleClock.md](needleClock.md)). The drawn needle is an estimate tuned
to move evenly; a cue is a value WRITTEN DOWN, and what is stored is what the engine said.

A short press on an **empty** button does nothing, rather than jumping to zero.

## What is stored: a position in the FILE

A cue is a place in the song — where the drop is, a fact about the recording. Storing a timeline
number would move **every** cue the moment the tempo fader is touched, silently.

There is no conversion to make. A deck is a platter, its needle is already in seconds of the file,
and that is the number a long press writes. The button reads **its own deck's** needle (`needle`),
never the transport: no deck follows the transport, so a cue set from it would be a number
unrelated to any point on the record — and jumping to it would work perfectly, to the wrong place.

## In mix.k7x, beside the song

```js
cues([
  "@k7-core/songs/Alain Bashung/Album inconnu/La nuit je mens",
  ref("@k7-core/songs/Daft Punk/Album inconnu/Around the world").markers([12.5, null, 48.25]),
])
```

**And that is all this file does.** Which songs the set plays is the playlist the surface names
([setList.md](setList.md)). A cue stays here because it belongs to the DESK playing the song and
not to a list other sets read: two bands covering the same title do not drop the needle in the
same place. An entry therefore appears when a cue is set, not when a song is added.

Not to be confused with `views/mix.k7x`, a different file: the desk's bindings, in `views/`, the
ones a surface names through its `mapping:`. This one is at the project root.

An entry is **either** a bare reference **or** a reference carrying settings. Both, deliberately:
a song with nothing to say fits on **one line**, which is every song until someone sets a cue on
it. Turning `cues:` into a table of references to almost-nothing would make every entry look like
it was missing something.

`markers` is **positional**: index 0 is button 1, and `null` is an empty slot. Button 3 stays
button 3 whatever happens to buttons 1 and 2 — a cue is muscle memory, and a list that closed its
gaps would renumber somebody's set mid-way. Only **trailing** empties are dropped, hence a single
number for a cue on button 1 rather than eight.

A song whose last cue is cleared **becomes a bare reference again**: a list nobody has cued is
just a run of bare references.

## Writing preserves the file

The text is **edited**, never reprinted from a parse tree. The scaffold's comments are the only
worked example a reader of a set gets, and a desk that ate them on the first cue set is a desk
you do not forgive. `withMarkers` edits the sheet as a k7x document (`K7Document`), value by value,
which leaves every other byte where it was.

A reference the file does not name is **added**. That is not politeness: a deck can be playing a
song someone has just removed from the list, and refusing the cue would lose a gesture already
made.

A write failure is **said**: the button has already turned colour, so a silent failure would leave
a cue present until reload and absent after it.

## One colour per BUTTON, not per cue

Button 3 has the same colour on both decks and on every song. That is what lets a hand find it
without reading — the whole point of a quick cue. The eight colours are spread round the wheel and
keep clear of the amber the tempo display warns in, so a cue is never mistaken for an alert.

## A cue moves ONLY its own deck

The engine still has one transport (see [mix.md](mix.md)), but jumping to a cue does not touch it:
it is the **platter** that moves, through its `Seek`, and a platter belongs to a deck. Dropping the
needle on deck B while A is playing does not move A.

A separated record is four platters, and `plattersOf` names all four: a cue reaches them together,
otherwise the four parts would drift apart.

There is no bound on the jump. A cue is a **fraction of the file**, so it cannot designate a place
that does not exist.
