# The Mix view — the desk

```
┌───┬──────────────┬───┬────────┬───┬──────────────┬───┐
│ ┃ │              │ ◍ │ ▮▯  ▮▯ │ ◍ │              │ ┃ │
│ ┃ │  PLATINE A   │ ◍ │ ▮▯  ▮▯ │ ◍ │  PLATINE B   │ ┃ │
│ ┃ │ (rempli à   │ ◍ │ ▮█  ▮█ │ ◍ │ (rempli à    │ ┃ │
│ ┃ │  40%, ● ● )  │ ◍ │ ▮█  ▮█ │ ◍ │  40%, ● ● )  │ ┃ │
│ ┃ │  ▁▃▇▅▂▃▇▅    │ ─ │  A   B │ ─ │  ▁▃▇▅▂▃▇▅    │ ┃ │
│KEY│ ①②③④⑤⑥⑦⑧   │A ═════╪═════ B│ ①②③④⑤⑥⑦⑧    │KEY│
│ ▶ │   titre      │   │  50%   │   │   titre      │ ▶ │
├───┴──────────────┴───┴────────┴───┴──────────────┴───┤
│ SYNC A ↺ ⟳ Écouter    🎧A 🎧B ♩ ⟳ ▬▬▬· ↺ ⟳ SYNC B │
└──────────────────────────────────────────────────────┘
   ↑ tempo fader, outer edge     ↑ the strip, inner edge:
      then KEY and THIS deck's      TRIM, 3 EQ knobs, the filter,
      ▶, two equal blocks           and the echo when one is wired
```

In the **middle**, the two channel faders with their meters, and the crossfader below: that is a
mixer's layout.

Under each vinyl, the waveform scrolling under the playhead, beats in yellow and transients in grey
— its own rules are in [waveform.md](waveform.md). On the outer edge the tempo fader, and at both
ends of the bottom bar the SYNC buttons: [bpm.md](bpm.md). On the inner edge the strip: trim, EQ
([eq.md](eq.md)), filter ([filter.md](filter.md)) and echo ([fx.md](fx.md)). Under the waveform the
eight cue points — short press to go, long to set: [cues.md](cues.md). **A click at the centre of a
vinyl** opens the song browser: [songBrowser.md](songBrowser.md). In the bottom bar, the metronome,
offered only when there is a single beat — one deck, or two in sync
([metronome.md](metronome.md)) — the master meter, and per deck the two momentary buttons, censor
and echo-out ([fx.md](fx.md)).

No file tree here. Not that Mix ignores the project — it plays the playlist this project's surface
names — but the desk wants the width. Files are Edit's business.

## The layout

Two decks facing each other, and nothing between them. Each carries its **tempo on the outer edge**
and its **strip on the inner edge** — three EQ knobs then the filter, vertically. The two strips
therefore face each other across the middle: the desk reads as a mirror rather than a repetition,
and a hand knows which deck it is on without looking up.

No song list in the middle: a song is chosen **at the record itself**, by clicking the vinyl's
centre, which is already how a deck is loaded ([songBrowser.md](songBrowser.md)). A column repeating
what the record already knows would take the space the decks want. Error cards are a banner above
the decks, shown only when something is wrong.

## The vinyls

An SVG record: a radial gradient (a real record reads because light moves across it), grooves, and a
centre label carrying **the artist and title** of what is loaded. Empty, the label reads « platine
A » or « platine B ».

The record **fills** as the track plays — empty at 0 %, full at 100 % — and carries the cues as
circles, each in its button's colour. Both live on a layer that does NOT turn, and are redrawn per
frame rather than by React: [vinyl.md](vinyl.md).

The record turns when the transport runs **and** this deck holds something. Two details that are not
decorative:

- **A lighter, dotted groove**, offset in the stack. A perfectly uniform spinning record looks
  perfectly still; that groove is what makes the rotation visible.
- **The label does not turn.** On a real deck it does, but a title you have to follow with your head
  reads badly — DJ software makes the same trade.

`prefers-reduced-motion` stops the animation: a record spinning in a loop is exactly what that
setting targets, and the deck stays legible stopped.

The artist comes from the song's tags; failing that — a song not yet in the cache, so with no
sidecar to read — from the **second segment of the id** (`songs/<artist>/<album>/<title>`), the
folder the mediatek filed it under. That is not a guess.

## The crossfade

### It is BETWEEN the two decks, from one cue row to the other

Not at the bottom. A crossfader moves from one deck to the other, and the gesture reads if it
happens **in the space that separates them** — the hand goes from A to B and the fader goes the same
way, at the height of the cues it has just left.

**Vertically**, it holds that line without measuring anything: its column **repeats the pieces** of
the column beside it — a row of the record's height, then one of the waveform's height, then itself.
All three values come from the same `deskLayout` the decks read, so the three lines cannot fall out
of alignment ([deskLayout.md](deskLayout.md)).

**Horizontally**, it runs from the right of A's cues to the left of B's — so it overruns its own
column, over both strips. A deliberate bleed (`CROSSFADE_BLEED`), and the value is not guessed: it
is the row's `gap-4`, the strip (`w-16`) and the deck's `gap-2`, exactly the distance from this
column's edge to the edge of a cue row. The strips centre their knobs vertically, so at the cue line
there is nothing under the fader.

> The only column where that contends is one so short that the strip fills its whole height —
> `stripLayout`'s scale then picking its smallest notch and still not fitting. The same case
> `deskLayout` already handles by letting the waveform overflow, and already unusable for other
> reasons.

The percentage under the fader follows the same rule as the title: it earns its line only in a tall
enough column (`layout.title`). It does not bleed — it stays centred on the column.

### The law

The fader drives both decks' levels, by the **exact** law the project's `crossfade` module writes in
its `jsdsp.ts`:

```
gain(A) = 1 - mix        gain(B) = mix
```

Constant gain, not constant power: it dips about 3 dB at centre for two uncorrelated sources. That
is the known shape of a constant-gain fade, not a bug — constant power needs a square root, and the
module does not have that primitive.

A strip's `Volume` is in **decibels** (−60 to +6, 0 = unity), never 0..1: a surface sending 0.5 for
"half" would look like it works and be six decibels wrong. `VOLUME_DB` states the range, `gainToDb`
converts, and silence is the **floor** rather than −∞ — a fader has a bottom.

Moving the fader sends **no** document: it is `set-plugin-param`, one message per movement, like
st0's knobs. Sending a whole project per pixel would broadcast a document to the engine that differs
by two numbers.

## The strip is a mixer, not three EQs

The crossfader is **not** a deck's level control. Most transitions are made at the **channel**, and
the three controls read in signal order:

```
deckA ─┐
stems ─┼→ trimA → eqA → filterA ─┬→ levelA → echoA → fadeA → MIX → OUT
       ┘                          └→ cueA → CUE
        ↑ input gain              ↑ channel fader       ↑ crossfade
```

### The trim is at the HEAD, and the reason is not taste

A deck is **five lanes** — the record, and one per separated stem — meeting on a bus
([stems.md](stems.md)). A trim on the record's lane would therefore do **nothing at all** on a
separated song, whose four parts play instead of the record. At the head of the bus, it reaches all
five.

Consequence worth knowing: the trim is what **names the chain**, so a strip's plugins are addressed
`trimA:eqA` and not `eqA:eqA`, and `bus_only:` names `trimA`. Naming the EQ there would point at a
STEP instead of a head, and the dry path would come back
([busOnly.md](../../../song/docs/busOnly.md)).

What it is for: **nothing here normalises loudness**. Two records cut ten years apart do not arrive
at the same level, and the trim is what makes them agree so that 0 dB on both channel faders means
the same thing.

### The channel fader, and why the cue is BEFORE it

`levelA` is in **decibels** (−60 to +6, 0 = unity), like every level here and for the same reason.
The bottom of the travel is **silence**, not −∞.

The headphone send is tapped on `filterA`, so **before** this fader: dropping a channel must not
take it out of your ears, whereas cutting its bass must be heard in the headphones before the room.
That is the definition of pre-fade listen ([cue.md](cue.md)).

## The meters

They come from the engine at no cost: the state frame already carries `levels[]` per track, `master`
and `masterClipped`, twenty times a second.

**Per channel, the meter is PRE-fader.** It reads the strip's track — the one the `deckA.trim`
binding addresses, so `trimA` — that is, after the EQ and filter and **before** the channel fader.
That is what setting a trim needs: you raise it until the meter approaches the top, fader down, and
only then open the channel. A post-fader meter would measure what you decided to send, not what you
have to send.

**The master is post-everything**, in the bottom bar: the only one that answers for the mix, and the
only place clipping shows. Its red indicator **latches** — clipping is reported for a 50 ms window,
and a lamp that told the truth only for that long is a lamp nobody sees.

The scale and the two memory rules (`meterFill`, `clipLatch`, `peakHold`) are in
`@studio/engine-browser/meter`, shared with st0's header meter: two copies of "is the lamp still
on" are two answers.

Each bar **subscribes for itself** to the store, and draws by `transform` rather than by a width: a
frame every 50 ms lifted up to the desk would redraw it twenty times a second to move eight pixels.

A host supplying **no** store is provided for: the bars stay at the floor instead of failing the
view. That is what `SILENT` is — a store never written, so the hooks stay unconditional.

### Deck B is MUTED, and that is not optional

The line whose absence makes the crossfader look dead — when it is not the crossfader.

`out` compiles as a **parallel** path: the dry signal carries on to the master beside the module it
feeds, which is what makes a send a send. Deck B feeds only the crossfade's second port, so unmuted
it reaches the master as well: heard once raw and once through the module, and pushing the fader
towards deck A does not remove it. Every setting sounds the same.

It works because Tracktion's mute node **deliberately** lets clips through to sends and sidechains:
the crossfade keeps its second signal, the master stops having a duplicate. See
`engine/st0-engine/docs/sidechain.md`.

Measured on `example.st0`'s compiled document, two 20 s tracks, rendering deck A alone as the
reference:

| render | level | residual against deck A alone |
|---|---|---|
| Mix = 0, deck B muted | −20.32 dBFS | **−120 dBFS** — identical |
| Mix = 1 | −23.26 dBFS | −18.55 dBFS — the other track |
| Mix = 0, deck B **not** muted | −18.51 dBFS | **−23.26 dBFS** |

The last line is the symptom: at Mix = 0, deck B is still there, at exactly its own level.
`scaffoldSet` writes the mute, and a test pins it.

## Playback goes through the compiler

The desk does not build the document: it **fetches the one the project compiles** (`/engine-doc` on
the file service), puts the decks' songs into it, and sends it over its own socket. What plays is
therefore the project: the chains, the `sidechainFrom: deckB`, and the crossfade's DSP graph **baked
by the compiler** — 768 bytes for `example.st0`.

Direct consequence: the crossfader does not move two levels, it sets `Mix` on `deckA:crossfade` —
the mediatek's module, through the binding declared in `views/mix.yaml`. Nothing on that path is
hard-wired.

`withDecks` touches **only** the clips of tracks carrying a loaded deck. A plugin, a send, an
automation the project declares stay the project's; touching them would put the desk back in the
business of deciding what a set sounds like.

**A stand-in exists**, deliberately: until the compile arrives, or for a project that does not
compile, `deckDoc` builds two tracks with one level each and the crossfader moves the levels. A deck
must be able to play before everything is ready; it is an imitation of the set, and it says so.

The tempo goes through its module too, by the other path. `tempo` is `offline`: no plugin, so
nothing to set a parameter on — but `offline` does not mean "does nothing", it means "rendered true
outside the graph". What a binding to such a module designates is the TRACK whose material it
treats, and the stretch is a warp on the clip `withDecks` fills there — which Tracktion does live.
See [bpm.md](bpm.md).

## One transport, and no button left for it

The engine has **one** transport, and **none of the music is on it**: each deck is a platter
carrying its own position (`engine/st0-engine/docs/turntable.md`), and this timeline's only inhabitant
is the metronome clip ([metronome.md](metronome.md)).

Hence: **the desk has no transport button.** Neither at the bottom nor in st0's header, which is
hidden while the Mix surface is alone on screen. They would command only the click while presenting
themselves as playback — and a button that looks like it starts the music without starting it is
worse than no button.

Instead, **each deck starts on its own**, by its ▶ at the foot of its tempo column, under KEY. That
is the column of things belonging to this deck alone, and starting is one. The two buttons are the
same height there, because a hand finds them without looking.

And the transport **follows**: as soon as one deck turns it rolls from zero, when none turns it
stops. That is what keeps the metronome audible without giving it a button back — the click belongs
to the music, not to a separate control. The rule lives in `useDeckSet`, in one effect, rather than
in each gesture that starts a deck.

What it does not remove: in a project that ALSO declares a timeline or a viewport, the header keeps
its transport as soon as either is on screen. It then commands something you can see.

There is **no exception** to per-deck start.

An **empty** deck keeps its button, **greyed**. The rule the cue points already state
([cues.md](cues.md)): greyed says "not yet", absent says "go and look for it". At the foot of the
tempo column, under KEY, an absent button leaves a hole, and a hole reads as a fault.

It forbids less than it seems, though. Three things that look like they need a second transport need
none, because they move the **platter** and not the transport:

- **lining up the downbeats** — bringing the slave onto the master's grid, which sync does
  ([bpm.md](bpm.md));
- **dropping the needle** — a cue, a needle-drop, a tape slide move only their deck
  ([scratch.md](scratch.md));
- **listening on headphones** — both decks already play at once, only a second output was missing
  ([cue.md](cue.md)).

Position is per platter: that is the property carrying all three.

## Under the cues, the loop row

One more row in each column: beat jump `◀ ▶`, manual `IN` / `OUT`, the three lengths `4 8 16`, `÷2`
and `×2` either side of the current length, and `⟲` **held** for a roll. Greyed with no measured
tempo, as the cues are greyed with no record — a loop is a length in *beats*.

It **does not drop** when the column narrows. The record goes first, the title next; the loop row
stays, because a desk that cannot loop is exactly what it came to fix. The quantise, though, is
drawn **once**, under the crossfader: it holds for both decks, and two buttons always in agreement
would say less than one.

The whole reasoning — why it is in the platter and not in a clip, and the parameter order that moves
the record if reversed — is in [loop.md](loop.md).

## Waiting for a place

`ChainsPanel` and `deckGraph` — a deck's effect chain, drawn — are mounted by nothing. Kept because
they work, they are tested, and options come back; the deck they draw is a **parameter**, so a panel
opened on deck B does not label its effects deck A. See the entry in
[docs/inventaire.md](../../../../docs/inventaire.md).
