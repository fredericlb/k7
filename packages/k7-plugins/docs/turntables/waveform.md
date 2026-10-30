# The turntable waveform

Under each record, a band that **scrolls beneath the playhead**: the track slides, the head
stays in the middle. The LOOK is the one every k7 waveform wears, painted by the same function
(`packages/ui-waveform/docs/spectrum.md`); the SCROLL is this band's alone. `@studio/ui-waveform`
draws a **whole** track into a given width, head crossing it; here a window of fixed duration,
and the audio moves. Two different questions — "what does this track look like" against "what
arrives in four seconds".

```
        past  ←            │            →  coming
   ▁▂▃▅▇▅▃▂▁▂▃▅▇▇▅▃▁▂▃▅▇▅▃▂│▁▂▃▅▇▅▃▂▁▂▃▅▇▇▅▃▁▂▃▅
   │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │      │ yellow = beats
                            ▲                        ╎ grey   = transients
                         playhead
```

## The window does not reframe

`window(at)` yields `[at - 4s, at + 4s]`, never clamped to the track's bounds. At the start the
left half is before zero and draws **empty**; at the end the right half overruns. That emptiness
is the information: "we are at the very beginning", "the track is about to run out". A window
sliding to stay inside the file would put the head somewhere other than the centre, breaking
this view's only promise in silence.

## Yellow = inferred, grey = measured

- **Transients** are what the engine actually detected, in file seconds, in the `{file}.cache`
  sidecar. Drawn as they are.
- **Beats** are a grid **inferred** from a tempo. The sidecar gives a BPM; it gives no *phase*,
  and nothing in the media library carries one — a master's tags hold a `bpm` that can be corrected
  by hand, no first-beat offset.

Hence the anchor: **the grid starts on the circular mean of every onset**, not on
`transients[0]` ([beats.ts](../../src/turntables/beats.ts)). One early transient — a cough, a lead-in note —
would otherwise drag the whole grid with it, where an average over every onset is dominated by
the beats that actually repeat. A Rayleigh test on the same onsets decides whether that phase is
a measurement or a shrug, and that is what `confident` carries. The day a real offset reaches the
sidecar, `anchor` is the only argument to change in `beatsIn`.

Grey is more discreet than yellow although grey is the one that is **measured**: yellow is what
you align on, which is what you look at.

**No tempo, no grid.** `bpm: 0` is the engine's "I found nothing". No yellow line, and "tempo
unknown" in the corner — a grid drawn at a guessed 120 would be a confident lie, and absent lines
with no explanation read as a bug.

## Where the data comes from

`GET /mediatek/envelope?path=…` on the chosen machine's file service — `ensureFileEnvelope`, a
**read** as long as the fingerprint matches. Otherwise that machine's engine computes it, several
seconds; hence "analysing track…" rather than an empty band, the two being indistinguishable
otherwise.

JSON rather than the sidecar's raw bytes: that is an internal format with a version and a
fingerprint inside it, and a browser parsing it would be a second implementation of `readSidecar`
waiting to diverge. ~120 kB for five minutes, 8192 buckets.

A bucket covers a duration that **depends on the track's length** — 8192 buckets whatever the
file. `bucketAt` accounts for it; assuming a fixed rate draws one track at another's speed.

## The position does not go through React

The engine pushes each platter's needle ~20 times a second. In React state that would re-render
the whole desk — two waveforms, the list, both decks — to move one line. The needle lives in a
**ref**, and the canvas reads it in its own `requestAnimationFrame` loop.

It reads the deck's **drawn** needle, not the raw one: the raw needle moves on one frame in three
and carries each frame's transit jitter into the scroll. The drawn one is steered between frames
at the deck's known rate ([needleClock.md](needleClock.md)). A stopped deck's drawn needle is the
raw one, so this file never tests `playing`: the clock and the band cannot disagree about what
"stopped" means.

The position is the deck's own, in seconds of its RECORD: every deck plays off a platter, and the
transport is no deck's clock.

## The track is painted once, then slid

The band scrolls under a fixed head, so from one frame to the next the picture is the same
picture moved. The spectrum is therefore rasterised once per track and size into tiles
(`SpectrumStrip`, `packages/ui-waveform/docs/spectrum.md`) and each frame blits the one or two
tiles in view at an offset; only the grid, the loop, the head and the two times are drawn per
frame. Painting every column every frame would cost an allocation, a colour string and a
`fillStyle` parse per pixel column, per deck, 60 times a second.

The canvas's size comes from a `ResizeObserver`, not from `clientWidth` in the frame loop: reading
layout there forces it, per deck per frame.

**A still band schedules no frames.** After half a second of frames that would paint nothing — a
stopped deck, no hand on the band — the loop parks, as the record's does (`Vinyl.tsx`), and only a
look at the needle every 100 ms remains, which a seek on a stopped deck is caught by. A hand on the
band, the deck starting, a new size and the desk coming back into sight (`inSight.ts`) wake it at
once; hidden, it schedules nothing at all. Two decks woke the main thread 60 times a second
otherwise, on a phone, with nothing moving.

## Bars, in thicker orange

A line every four beats, wider than the yellows and in a **different hue**: at a glance you count
bars rather than working out which yellow is which. Drawn AFTER the beats, so a downbeat is
orange rather than a yellow line fringed with orange.

**4/4 is assumed, not detected.** Nothing in the sidecar says where a bar begins, and the
analysis measures a tempo, not a metre. The grid's first beat is taken for a downbeat, one in
four after that. On the four-to-the-bar a deck plays most of the time this is right — or right to
within a rotation, and a rotation still gives one line per bar to count by, which is what a bar
line is FOR. On 3 or 7 it is decoration, and the code says so rather than pretending.

`barsIn` and `beatsIn` share the same grid and the same anchor: a bar grid with its own anchor
would drift against the yellow lines it is meant to underline. A test freezes it — every bar
falls ON a beat, never between two.

## The colour says what is INSIDE

Red where the bass is, green in the voice, blue on the cymbals, and the blends between — a
classic turntable's vocabulary. Not a drawing problem: `peak` and `rms` carry **no**
per-frequency data, so the analysis is what must produce it. The engine splits the signal into
three bands as it reads it and writes `low` / `mid` / `high` into the sidecar in the same bucket
space as `peak` — a consumer indexes all four alike.

### The split, engine side

Two one-pole followers, at 200 Hz and 4 kHz, and the three bands are their differences:

```
lpLow  += aLow  * (v - lpLow)     // under 200 Hz
lpHigh += aHigh * (v - lpHigh)    // under 4 kHz
low = lpLow        mid = lpHigh - lpLow        high = v - lpHigh
```

Complementary **by construction**: `low + mid + high` gives the signal back exactly, so a
column's colour cannot invent energy it does not have. A drawing needs no steep filters — it
needs the three to recompose. 200 Hz keeps kick and bass on one side, 4 kHz cymbals and the top
of a hi-hat on the other, and the middle is where voices and snare live.

**Peaks** per bucket rather than RMS, for the reason that already holds for the main envelope: a
kick is an attack, and averaging it over a bucket is precisely how you lose what you meant to
show.

### The blend, drawing side

The colouring is not this band's own: it lives in `@studio/ui-waveform`, which every k7 waveform
paints through, and its choices (the additive mix, normalising by the loudest band) are argued in
`packages/ui-waveform/docs/spectrum.md`.

### What it costs

The sidecar is at **v4**, and the version gate carries the weight: a sidecar from an earlier
version has a fingerprint that MATCHES — the audio has not changed — so without the version
number every freshness check passes and the track never gets its bands. A track analysed under an
earlier version is therefore re-analysed on demand. Until it is, it has no bands at all and its
waveform stays grey — which reads as "not analysed that way" rather than as silence, and is why
the three fields are optional end to end.

## Dragging the band is a SHUTTLE, not a step

The band is dragged to move the record, and the gesture is a shuttle wheel rather than a slider:
**the distance held is a speed**, not a displacement. Offered only with a track loaded AND a
tempo measured — without a stretch ratio there is no conversion between a pixel and a file
second.

| | |
|---|---|
| towards the **left** | it goes **forward** |
| towards the **right** | it **rewinds** |
| further out | faster |
| on release | **one** seek, and one only |

The direction is not a convention to memorise: the audio slides leftward under a fixed head, so
pulling left brings what is coming towards you. The hand does what the audio does.

`shuttleRate` is the function, and it is **squared** rather than proportional. That is the point
of a shuttle: one gesture has to cover "nudge it by a hair" and "go to the chorus", which a
straight line cannot do — calibrated so the edge is useful, the first few pixels already run. A
third of the travel is a **ninth** of the speed, and the last thirds do the rest. The maximum is
reached at **half** the band, the head's distance to the edge: pulling the whole visible future
under the head is as fast as it gets. A dead zone of a few pixels keeps a shaky click still.

### Nothing is seeked while the hand is down

The offset is integrated **over the view's frames** — hand still, the record keeps running — and
drawn by adding to the live `needle`. The engine hears nothing. That is what the gesture asks
for: you search by watching, and decide only on letting go.

On release, one `onShove` leaves with the total, and the position reached is **held** until the
needle arrives (`HOLD_EPS`, or `HOLD_MS` at worst): without that the band snaps back to where the
record still is, for one round trip, before jumping. Both are `ref`s, like the `needle` itself
and for the same reason — a shuttle at 60 frames a second going through React state redraws both
decks, the list and the graph to move one line.
