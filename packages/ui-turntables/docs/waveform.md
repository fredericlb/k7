# The turntable waveform

Under each record, a band that **scrolls beneath the playhead**: the track slides, the head
stays in the middle. This is not the waveform the rest of the repo draws and must not become it —
`@studio/ui-waveform` draws a **whole** track into a given width, head crossing it; here a window
of fixed duration, and the audio moves. Two different questions — "what does this track look
like" against "what arrives in four seconds".

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
  and nothing in the media library carries one — `song.yaml` has a `bpm` that can be corrected by
  hand, no first-beat offset.

Hence the anchor: **the grid starts on the circular mean of every onset**, not on
`transients[0]` ([beats.ts](../src/beats.ts)). One early transient — a cough, a lead-in note —
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

## The playhead does not go through React

The engine pushes `playhead` several times a second. In React state that would re-render the
whole desk — two waveforms, the list, both decks — to move one line. `useEngine` writes it into a
**ref**, and the canvas reads it in its own `requestAnimationFrame` loop.

Between pushes the position is **extrapolated**, but not from the last frame: frames land with
different delays — engine timer, socket, parsing — so re-anchoring on each one **copies that
jitter** into the scroll, 60 frames a second of judder instead of 20. The canvas reads
`Deck.drawNow` instead. The transport's rate being KNOWN — one second per second, pitch fader
included, since that stretches the clip and not the transport — the clock predicts from local
time and estimates only the OFFSET, keeping the least delayed frame of a recent window
(`@studio/engine-browser/playhead-clock`). The drawn position is a straight line, and a real seek
moves the window back. It decides on its own when things are stopped, which is why this file
never tests `playing`: the two cannot be allowed to disagree on what "stopped" means.

`drawNow` is for what you WATCH. What gets written down — a cue point, remembering where the
finger fell — reads `Deck.playhead`, the raw anchor, because smoothing trades accuracy for
continuity. See `apps/st0/frontend/docs/playhead.md`.

## One playhead for both decks, but two clocks

The engine has a single transport (see [mix.md](mix.md)), so the same ref serves both bands.

The transport's position is **not** the position within each track, because the two clips do not
both start at 0: a stretched deck runs at its own rate, a synced deck is delayed to meet the
other, and each clip starts a margin into the timeline ([bpm.md](bpm.md)). Drawing the raw head
against the envelope gives the wrong place in the track, silently, and only once someone has
touched the deck. The band therefore converts, through the `sourceAt` the record and every marker
already use. One head, two file clocks; the day the decks get independent transports, it is the
shared ref that goes, not the conversion.

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

**Additive**, and that is the whole trick. Bass red, mid green, top blue: blending them is
ordinary light, so bass+mid gives orange-yellow, bass+top gives violet, all three give white.
Exactly the palette described — out of arithmetic instead of a table of special cases someone has
to maintain.

Each band is pulled towards its hue (bass towards orange, top towards violet) but keeps a
**weak** contribution in the two channels it does not own. Too much green across red and blue and
bass+top comes out nearly white instead of violet: what a band contributes to the channels that
are not its own is what decides whether the blends land right.

Normalised by the **loudest** band, not by the sum. What a coloured waveform says is which band
DOMINATES here, and that must read the same in a quiet passage and a loud one; with a sum, a
column that is nothing but bass comes out at a third of its intensity and reads as muddy brown.

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
