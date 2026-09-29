# realtime.ts — drawing the viewport live

## One `<video>` per LAYER — and a second only where a lane dissolves

A layer shows one clip at a time by construction, so per-clip elements would mean N
decoders for a lane that displays one picture. A cut swaps the element's `src`, which
costs a visible hitch.

A **transition** is the one thing that needs two pictures at once, so a lane gets a second
element exactly when one of its clips declares a `fade_in`
([transitions.md](../../song-video/docs/transitions.md)). Three notes on that condition:

- it is `fade_in` and not "has a fade": a `fade_out` goes to a transparent texel, so it needs
  no second decoder — which halves the lanes that pay;
- it is settled once, in `create`, off the scene. The driver is rebuilt whenever the document
  changes, so a song that gains its first dissolve gets a new driver like any other edit;
- a song that never dissolves allocates exactly what it always did. Browsers cap concurrent
  hardware decoders, and a six-lane project with a picture-in-picture is already close.

Elements are claimed by the clip's **INDEX in `layer.clips`**, never by its `src` or its id — a
clip's id is its material REF, so a shot placed twice has one id, and a shot dissolving into
itself would otherwise put both halves on one decoder. Index-claiming also ping-pongs for free:
during A→B the outgoing shot keeps its element and the incoming one takes the other, so after
the dissolve B stays where it is and the next transition loads C on the element A vacated.

`onSeek` re-seeks **both**: scrubbing into the middle of a dissolve has to land the pair, or the
first frame after the scrub blends the right shot with a stale one.

The element is muted (the file's audio is dropped by design, and muted is also what lets
it autoplay), parked 1px and invisible but NOT `display:none` — a `display:none` element
is allowed to skip decoding.

## Two-speed drift correction

The engine and each `<video>` keep independent clocks, so they drift continuously.
`step()` corrects with two mechanisms:

- **a small drift** is nudged out via `playbackRate` — invisible, but slow to converge,
  and only while playing;
- **a large jump** is hard-seeked — correct and instant, but it flushes the decoder and
  shows a hitch.

That asymmetry is the whole design: the cheap correction handles the common case
silently, and the expensive one is reserved for when the picture is already wrong enough
to be worth a visible reset.

This is also why realtime can be approximate where `export.ts` is not: a `<video>` seeks
to the nearest decodable frame, while the exporter pulls the frame whose presentation
interval contains the requested second, exactly.

## Parking a lane

A lane is parked — paused and left out of the composite — in four cases: the layer is hidden,
nothing is on it at this instant, it is a shape layer with no element, or the playhead has run
**past the source's material**. That last one is not tidiness: `currentTime` clamps short at the
end of a file, so the error never closes and the hard seek above would fire on every frame,
thrashing the decoder toward a frame that does not exist. Export skips a layer with no sample
there for the same reason, and preview must agree with it.

The fourth case is **per ELEMENT rather than per lane**, and that is load-bearing rather than
tidy: a `fade_out` on a shot that runs to the end of its material is the commonest fade there is,
and parking the whole lane for it would drop the lane's entire composite for the length of the
fade. One element going quiet leaves the other's picture — and the blend says which slots carry
one, so a side that has nothing this frame is simply the transparent texel.

## The clocks

`clock.ts` holds three, and the compositor cannot tell which one it has — that is what keeps the
renderer independent of where its time comes from.

| | what it answers to |
|---|---|
| `EngineClock` | follows a playhead reported over a socket |
| `FrameClock` | stepped by the exporter; no wall clock, so a render is reproducible |
| `TransportClock` | is the authority itself, for a host with no engine |

Only the realtime driver needs `SeekingClock`. Drawing a frame just asks what second it is, while
chasing one with a `<video>` has to know when the answer stopped being **continuous**, so it can
hard-seek instead of nudging a `playbackRate` towards a target that moved.

`EngineClock` interpolates because the engine reports about 20 times a second: 50 ms of jitter is a
visible stutter at 30 fps, so a frame sets an anchor and wall time carries it forward. It reads `performance.now()` and never `Date.now()`:
the latter is the WALL clock, which an NTP correction or a daylight step can move backwards under a
running transport, and every reader here subtracts two readings, so a backwards step reads as the
picture jumping. It is also coarser. Monotonic is the whole requirement.

`TransportClock` is **unused in this repo** — st0 hosts the renderer and has an engine, so the
picture follows `EngineClock`. It is kept because the seam is the point: for a host with no device
whose sample position the picture must agree with, inventing an engine to keep time would be a whole
process running to hold a number. It has no drift to correct (there is no audio clock to drift
against), but it MUST still announce its own discontinuities — seeking and the play/pause edge both
fire `onSeek`, and a seek that stays quiet leaves the picture on the frame before it.
