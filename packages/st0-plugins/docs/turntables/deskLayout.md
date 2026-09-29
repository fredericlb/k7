# The desk adapts to its height

The desk is a **pane** (`layout: split`, see
[packages/song/docs/surfaces.md](../../../song/docs/surfaces.md)). Its height is therefore not a
constant: half the column beside the graph, the whole window under `full`, a third of a phone in
landscape. `deskLayout.ts` answers "at this height, what do we draw", and `useContentHeight.ts`
is what measures it.

## The record goes first

At full height a deck stacks the **record**, the **waveform**, the **eight cue points** and the
**title**. That wants roughly 510 px of column, 352 of it for the record alone — so in a
half-height pane the record on its own fills what there is.

Things fall in the reverse order of what they are worth:

| | what happens | why |
|---|---|---|
| 1. the **record** | shrunk, then dropped below 176 px | it is the biggest and the least load-bearing: what it says — where you are, where the cues are, that it is turning — the waveform says too, **and it also says what is coming**. Below 176 px it is a coin: the label is unreadable, the cue rays merge, and the rotation stops showing. |
| 2. the **title** | dropped on the shortest columns | the record's label carries the same words as long as there is a record; this line only earns its place once there is none. |
| 3. the **cue points** | never dropped | eight fixed positions a hand learns are worth nothing if they are sometimes absent — the argument `CueButtons` already makes for drawing them on an empty deck. |
| 4. the **waveform** | never dropped, and it GROWS | it is what a deck is for. |

### And drawn even when empty

The waveform is **not** conditional on `load`, despite the argument that an empty band under an
empty deck is furniture. A desk whose controls appear and disappear with what is loaded is a desk
that moves under the hands: the band would push the cues and the title down the instant a song
arrives, and the place the eye learnt would not be there to be learnt. Empty says "nothing yet";
absent says "look elsewhere". It is also where "analysing the song…" and a failed analysis are
said ([waveform.md](waveform.md)) — two unreadable sentences on a band that does not exist.

Point 4 is the real content of "hide the decks": the waveform **takes the room the record gave
back**, up to 180 px. Without that the pane would be a short band and a lot of nothing, which is
worse than the record. The 180 ceiling is there because a waveform is read for its **shape** —
where the drop is, where the beats are — and past a point more amplitude says nothing new. The
rest of the room keeps the cues and the title where the hand expects them.

## The stem block, which costs nothing while there is a record

The four stem knobs are on the **same row as the vinyl**, to its left ([stems.md](stems.md)).
That is free in height: `stemStripHeight` is at most 150 px at the widest step, when the smallest
record drawn is 176. The row is the size of the record and the budget is unchanged.

That is not a coincidence to leave sleeping: `deskLayout.test` checks
`stemStripHeight(s) <= VINYL_MIN` at every step of the scale. A knob drawn bigger here, or a
third row, would break the inequality — and break it silently, growing the row until the waveform
is pushed out of a column whose sum nobody rechecks.

When the record has gone (step 1 above) the block has no neighbour. It then takes a row of its
own and the waveform pays for it — growing slightly less than the record freed. That is
`deskLayout`'s second argument, and it exists because the answer depends on the SET: a desk that
wires no stem cut must not reserve room for a block it never draws.

A third test adds the whole budget — waveform, cues, title, gaps, block — at every height a pane
can have, and requires the sum to fit in the column. It is the only check that catches an
arithmetic error here without looking at the screen.

## And the channel strip, which shrinks or loses its filter

A deck has **two** columns: the one above, and the **strip** — three EQ knobs, a rule, then the
filter (`ChannelStrip`). It wants **317 px** at full size, and a half-height pane on a 768 window
gives the row about **206**.

Its knobs are `justify-center` in a box with no `overflow`. Content taller than its box therefore
overflows **equally on both sides** — and the two things at the extremes are the top knob and
**the filter**. A strip that did not shrink would give that symptom: not a filter cut in half, a
filter *gone*, while the three EQ bands look fine.

Nothing is **removed** here, unlike the record: three bands and a filter is what a strip IS, and
a strip without treble is not a smaller strip. It shrinks in steps, because a knob is a drawn
object and interpolating between 36 and 32 would produce a 33 nobody chose:

| row | knob | filter | values |
|---|---|---|---|
| ≥ 317 | 36 | 44 | yes |
| ≥ 285 | 32 | 40 | yes |
| ≥ 203 | 28 | 34 | no |
| ≥ 169 | 24 | 28 | no |
| otherwise | 20 | 24 | no |

What goes first is the **values** under the knobs: the number is a comfort, the knob is the
control. That line of text is what pays for the filter staying on screen — and what makes the
trade acceptable is that the knob carries an **arc** from noon to the pointer whose length is the
setting ([eq.md](eq.md)). The quantity stays readable without the number, and the arc costs no
height.

`stripHeight` writes the arithmetic out and a test walks it from 0 to 900 px: at every height,
either the strip fits or it is already the smallest. The `justify-center` without `overflow` is
correct **only** because of that guarantee.

## Measured, not handed down

`MixView` observes the **deck row** with a `ResizeObserver` and reads its `contentRect` — so
without the container's `p-4`, which means `deskLayout` receives exactly what a `DeckSide` has.

Measured rather than given a `compact` boolean by st0, because st0 does not know that number
either: the height depends on the window, the log pane, the error cards at the top of the desk,
and whether there is a timeline. A flag would be st0 guessing.

`deskLayout` is **total**: 0 (before the first measurement), a negative, or a fractional pixel
all answer with a drawable layout. The first frame therefore draws a readable desk and the second
the right one, with no `NaN` reaching a style attribute.

## The slack falls ABOVE the waveform, not below

The record is **capped** at 352 px. A column taller than what `deskLayout` draws therefore has
slack, and there is a lot of it as soon as the desk goes full screen:

| column height | drawn | slack |
|---|---|---|
| a pane, half of a 1080 | 470 | **0** |
| a pane on a big screen | 548 | 152 |
| full screen on a 1080 | 548 | **452** |
| full screen on a 1440 | 548 | **812** |

`DeckSide` puts `mt-auto` on the **waveform + cues + loop + title** block: everything you TOUCH
is anchored to the bottom of the column, and the slack goes above. Stacked from the top instead,
the slack falls after the title, floating the waveform, the cues and the loop towards the middle
of the screen and away from the edge a hand looks for.

The record does not stay stuck at the top of that slack either: the row carrying it is `flex-1`
rather than `shrink-0`, so it takes everything the bottom block leaves, and its own
`items-center` puts the record in the **middle** of that room. The stem knobs are in the same
row, to its left ([stems.md](stems.md)), and follow without asking. No `min-h-0` on it: a row
able to shrink under the record it carries would make it overflow, and `deskLayout` has just
computed that it fits.

The inequality that assumes is held by a test (`deskLayout.test`, "the slack a tall desk has"):
the column never draws **more** than its height — or the block would be pushed out of the bottom
— and draws strictly **less** full screen, or the anchoring would be pointless.

### The middle column follows, and the crossfader lands on the waveform

The desk has three columns, and two of them are anchored at the bottom. The third has to follow,
or the full-screen slack falls under the crossfader while the decks have it above.

What the crossfader mixes is the two bands, so its place is the **waveform's**. It is therefore
drawn in a box of exactly the waveform's height, followed — **with no gap** — by a row of height
`underWave(layout)`. The middle block is then the same height as a deck's block, and both
anchored to the same foot land on the same line:

| height | record | waveform | top of the band |
|---|---|---|---|
| 470 (pane) | 274 | 80 | 286 — crossfader 286 |
| 700 | 352 | 80 | 516 — crossfader 516 |
| 1000 (full screen) | 352 | 80 | 816 — crossfader 816 |
| 1360 | 352 | 80 | 1176 — crossfader 1176 |

`underWave` lives in `deskLayout.ts` with the four constants it adds: a copy in the view would be
a copy that goes stale silently. `deskLayout.test` ("where the crossfader lands") holds the
equality at every height, title drawn or not — it is all that guarantees the alignment, since
`MixerColumn` computes no number of its own.

#### And its WIDTH: `self-stretch`, not `w-full`

The crossfader must end where the neighbouring waveform ends. It therefore overflows its column
by `CROSSFADE_BLEED` on each side — the row's `gap-4`, the strip's `w-16`, the section's `gap-2`
— through two negative margins.

What gives it its width is **`self-stretch` in a column container**: a stretched element is sized
to the container **minus** its margins, so two −88 margins make it 160 + 176 = 336, edge to edge
between the two bands. `w-full` in a row is **not** the same thing: it is plain 100 %, i.e. 160,
and the margins then only shift it 88 to the left — a bar too short and set crooked, which
nothing can report.

The three numbers in `CROSSFADE_BLEED` are a **copy** of classes written in three other files,
and a stale copy breaks nothing: the bar simply stops a little short. `crossfadeReach.test`
therefore re-reads those classes and refuses the sum if one of them has moved.
