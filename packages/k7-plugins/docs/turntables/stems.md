# Stems on the desk — taking an instrument out of the record

Four knobs per deck, to the **left** of the record, in the EQ's format, laid out **two by two**:
drums and bass on top, vocals and other below. **At centre** the part sounds as the separation
wrote it; hard left it disappears, right it goes up to double.

What it really does is a **sum**: a separated song is no longer played by its own lane, it is
played by its four parts and each knob doses one. That is what every commercial stem deck does.
The reasoning, and the two shapes that preceded this one, are in
[`packages/song-schema/docs/stems.md`](../../../song-schema/docs/stems.md). At rest the output is
the record to within **34 dB** — the model's reconstruction residue, measured and stable.

## The block, and why it is not mirrored

The two decks face each other — tempo on the outer edge, EQ on the inner — so a hand knows which
one it is on without looking up. **The stems escape that rule**: on both decks the block is **on
the left**. What those four knobs dose is a property of the RECORD and not of the desk's
geometry, and looking for "the bass of the right-hand deck" must not require knowing which side
the block is on today.

**Beside the RECORD, not in a column of its own.** It sits in the deck's column, on the same row
as the vinyl and to its left, above the waveform. The same hand puts the record on and takes the
vocal out of it, so both gestures are in one place — and the waveform keeps the full width,
because it is read edge to edge.

It costs zero height: the block is shorter than the smallest vinyl drawn (`VINYL_MIN`, 176 px) at
every step of the scale, so the row is the size of the record. `deskLayout.test` holds that
inequality at each step, because it is what `deskLayout` assumes: a step where the block were
bigger would grow the row and push the waveform out of the column, with nothing to say so.

When the column is too short for a record, the block has no neighbour and takes a row of its own
— there it costs its height, and `deskLayout` takes that off the waveform. Hence its second
argument: a desk wiring no cut must not pay for a block it does not draw.

Same knob, same size scale, same centring as the strip next door (`ChannelStrip`) — the same
gesture on the same kind of thing, **and the same travel**: the middle is neutral and it goes
both ways, like an EQ knob. A knob whose neutral is one end of its travel reads badly: the hand
cannot find the rest position, and half the travel — reinforcing the instrument, which a remix
asks for all the time — would not exist. Neutral here is **1**, the record as it was cut, and that
is where a double-click puts the knob back: mid-travel, not the silence at the bottom of it.

**Two by two, and in that order.** `STEM_GRID` is not `STEMS`: the model's order is
`drums, bass, other, vocals`, the hand's is the rhythm section on top and what sings below. A
column of four makes the eye walk the list; a square is aimed at. The first reflex of an evening
is the drums, the second the bass — they are on the same row. A test holds both halves of the
property: that the square contains the four stems exactly once, and that the first row really is
the rhythm section.

The block **has no scale of its own**: it takes the strip's, so that every knob on one desk has
one size. That is only safe because it is SHORTER at every step — two rows against three EQ knobs
plus the filter, bigger, plus its rule. `deskLayout.test` holds the property at each step anyway,
because it is what authorises the borrowing — and it would break the way the filter disappears
when the strip does not shrink, by overflowing a box centred at both ends
([deskLayout.md](deskLayout.md)).

## One glyph per knob

Each knob carries an icon on its label line: a drum, a guitar, a microphone, and a note for the
catch-all. The catch-all keeps the generic note **on purpose** — `other` is what the model could
not file elsewhere, so drawing a piano or a synth there would name an instrument that may not be
in it.

The icon is beside the word, not instead of it: at 9 px a glyph alone is guessed rather than
read, and the column has the width for both. It is sized on the label's LINE (`h-[9px]`) and not
freely, because `knobBlock` counts that line at 9 px: a taller icon would grow every block by a
few pixels, which nothing would catch up ([deskLayout.md](deskLayout.md)).

Measured in the `Desk/Knobs` bench: the forty label lines — eight knobs at five steps — are 9 px
tall, and the widest is 41 in a 64-wide column.

A test holds the other half, the one you do not see: that every stem and every EQ band has an
entry in its table. A missing entry draws nothing and says nothing — a knob shows what it is
handed.

## Four states, four readings

| state | what you see | what you do |
|---|---|---|
| the set wires no cut | **no block at all** | nothing: a desk without stems is a complete desk |
| wired, record not separated, no `stems:` | four grey knobs, with the reason on hover | `playlist stems <playlist>`, or write `stems: true` |
| wired, record not separated, `stems: true` | four grey knobs and **the percentage over them** | wait — it is happening |
| wired and prepared | four live knobs | turn up the one you want gone |

The first is deliberate: a set without those lines in its `mapping:` asked for nothing, and four
dead knobs would be worse than no knobs. It is also why stem controls are **offered without being
required** — `SURFACE_MAPPING_SKELETON` proposes them, `REQUIRED_CONTROLS` does not demand them.
"What can be wired" and "what must be wired for this to draw" are two lists, and the stems are
what separates them.

The second reads off the block because the scan reports it: `meta.stems` is true when a `stems/`
folder is there, read off directory entries already in hand — not one more syscall per song, and
the same question the preparation command asks before skipping a song.

## Catching up: putting on a record nobody prepared

That is the third state, and it hangs on one line of the surface file:

```js
// surfaces/desk.k7x
type("turntables")
layout("split")
playlist("ete-2026")
stems(true)              // this desk catches an unprepared record
```

It turns "this song has no stems" from a dead end into a job: the record goes onto the deck
**immediately** and the separation starts behind it, `POST /api/stems` on **the media library** then a poll
every two seconds. On the media library and not on the file service: it holds the masters, so it
leads the split, borrowing the named engine's model (`apps/k7/backend/docs/media/stems.md`). `library` is this package's
second seam for that one reason.

The percentage is drawn **over** the dead knobs, not above them: the block borrows the strip's
size scale (`stemStripHeight`), and one more line of text would take it outside the height it was
granted, whatever the margin of the moment.

**A boolean, not a string.** Naming the chain in this file would ask the project a question that
is none of its business: which module separates and which model it wants is one answer for the
machine, written once by `system stems` into `<state>/preferences.yaml`. What a SET decides is
whether an hour of arithmetic may start because a record was put on — and that is decided per
set: a rehearsal machine and a stage machine do not answer alike.

When the files arrive the desk resends the document with the four lanes filled (`stemsArrived`).
The song does not stop, the tempo does not move, the transport does not either: what changes is
what `withDecks` finds to place.

Three things it does not do, each a decision:

- **Nothing starts without `stems: true`.** A separation is minutes of arithmetic; it happens
  because the project ASKED, never by default. And nothing starts either if the machine has no
  chain: the route then answers a 409 naming `system stems`.
- **Nothing starts twice.** The job id hashes the WORK (`separateJobs.ts`), so putting the same
  record on both decks, or reloading the tab, joins the running computation.
- **Nothing arrives on the wrong record.** `stemsArrived` checks the song id, and each load
  invalidates the previous poll loop. A separation takes minutes: the record it is preparing has
  ample time to be taken off.

The desk sends **no chain**: the request is the song and nothing else. Which module separates and
which `.onnx` this machine holds is a question the browser cannot ask, and one the machine has
already answered once — hence a separate route, the only one of the three tied to a workspace,
see [stem-separation/docs/stemSplit.md](../../../stem-separation/docs/stemSplit.md).

And the order matters: the route asks about the RECORD before reading the preference and before
resolving the chain. A machine never told how to separate therefore still plays, knobs live, the
songs prepared by command.

## What must stay true

- **A deck's five clips are sample-aligned.** Same `start`, same warp, same `slip` — `withDecks`
  fills them in one place for that. A one-sample drift does not make a quieter instrument: it
  makes a comb filter, and nothing on screen would say so.
- **The record's lane is EMPTY when the song is separated.** The four parts *are* the record;
  playing it as well would double it. The same `withDecks` decides both, both ways.
- **An incomplete `stems/` folder does not count as separated.** `stemsComplete` demands all
  four: three parts out of four is not a half-successful separation, it is a song missing an
  instrument, and putting it on a deck would be audible with nothing to say so.
- **The four parts are four PLATTERS**, as an unseparated record is one. They share a position, a
  rate and a `Key`; `plattersOf` names them, and one gesture — cue, scrub, scratch — reaches them
  all. That is what makes a separated record scratchable. The cost is measured:
  `packages/k7-plugins/scripts/turntables/put-on.ts`, and 157 ms more to put on a 4-minute song.
- **The tempo does not get in the way.** A sum requires no cancellation, so each part stretches on
  its own, keylock on or off ([bpm.md](bpm.md)).
- **An unseparated song leaves its lanes EMPTY**, and its own lane plays it. Placing four clips on
  absent files would make "put a record on" depend on an hour of computation nobody asked for.
- **The knob speaks in proportion, not in dB.** What is asked for is a share of the instrument,
  and making it disappear has to be a position on the travel — which a −60 dB floor is not.
- **Stems are written as 24-bit WAV.** Not float, not FLAC: Tracktion reads a WAV directly and
  decodes everything else into a proxy before playing, which would be paid at the precise moment
  a record is put on — five decodes, the mix and its four stems. The full reasoning and the size
  table are in
  [stem-separation/docs/stemSplit.md](../../../stem-separation/docs/stemSplit.md).
