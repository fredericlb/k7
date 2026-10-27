# realtime.ts — drawing the viewport live

## One `<video>` per LAYER — and a second only where a lane dissolves

A layer shows one clip at a time by construction, so per-clip elements would mean N
decoders for a lane that displays one picture. A cut swaps the element's `src`, which
costs a visible hitch.

A **transition** is the one thing that needs two pictures at once, so a lane gets a second
element exactly when one of its clips declares a `fadeIn`
([transitions.md](../../song-video/docs/transitions.md)). Three notes on that condition:

- it is `fadeIn` and not "has a fade": a `fadeOut` goes to a transparent texel, so it needs
  no second decoder — which halves the lanes that pay;
- it is settled per scene, off the layer's clips: a song that gains its first dissolve gets its
  second element at the next `setScene`, like any other edit;
- a song that never dissolves allocates exactly what it always did. Browsers cap concurrent
  hardware decoders, and a six-lane project with a picture-in-picture is already close.

Elements are claimed by the clip's **INDEX in `layer.clips`** first, never by its id — a
clip's id is its material REF, so a shot placed twice has one id, and a shot dissolving into
itself would otherwise put both halves on one decoder. Only when no element holds that index does
the `src` an element already carries decide, so a free element that has the file buffered is
preferred over one that would reload. Index-claiming also ping-pongs for free:
during A→B the outgoing shot keeps its element and the incoming one takes the other, so after
the dissolve B stays where it is and the next transition loads C on the element A vacated.

`onSeek` re-seeks **both**: scrubbing into the middle of a dissolve has to land the pair, or the
first frame after the scrub blends the right shot with a stale one.

The element is muted (a shot's sound is the ENGINE's, on an audio lane —
`packages/song/docs/videoSound.md` — and muted is also what lets it autoplay), parked 1px and invisible but NOT `display:none` — a `display:none` element
is allowed to skip decoding.

## An edit is a `setScene`, never a new driver

A document edit — a title typed, a clip nudged — reaches the viewport as a new scene on every
autosave. Rebuilding the driver for it would mean a new WebGL2 context, every shader compiled
again, every `<video>` made, buffered and seeked from nothing: the picture flashes black and
re-decodes on each keystroke's save. So the driver lives as long as its GL context, and only a
lost-then-restored context builds a new one.

`setScene` hands the scene to `Compositor.setScene`, which keeps the context and its render
targets, and matches the elements it already has to the new layers (`src/lanes.ts`): by layer
and a src the layer plays, then by src from any layer, then whatever is left over. Only the
elements nobody takes are released, and only the shortfall is created. A camera lane is kept
while it names the same lens, since reopening one is a permission prompt.

Clip indices mean nothing across an edit, so a kept element forgets which clip it held and is
claimed again by the src it carries — which is what makes a kept element cost no reload. The
upload memo is forgotten, since the compositor's slots come back empty. With the transport
stopped, nothing chases the clock, so an element further than a frame from where the edit moved
its shot is seeked there; while playing, the drift control does that on its own.

## A knob is set in place, not a scene

A shader knob moved by hand is `setParam(node, name, value)`: the value goes onto the passes that
node runs, and the next frame draws it. A `setScene` would compile every pass's program again for
each step of a drag. A node with no pass yet answers false, and waits for the next scene.

## A still takes no element

A shot whose clip is an IMAGE is decoded once per source into an `<img>` and uploaded into its slot
as any frame is. It claims no `<video>` and has no clock to chase, so a lane of stills costs no
decoder. Until the image has decoded the slot carries nothing, which shows the lane beneath rather
than a blank. Export decodes the same file once into an `ImageBitmap`
(`packages/song-video/docs/media.md`).

## A retimed shot: the rate is the shot's, or the element is stepped

A shot running at `speed` plays its element at that `playbackRate`, and the drift nudge below
works around it rather than around 1. A browser plays forwards only, and only between 1/16 and
16. So a freeze, a reverse, or anything outside that range is shown by PARKING the element and
seeking it whenever it is half a frame off. Every frame is the right one, but a reverse previews
choppier than export renders it (`packages/song-video/docs/speed.md`). A reverse reaching its
source's first frame is parked like a shot past its last.

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
tidy: a `fadeOut` on a shot that runs to the end of its material is the commonest fade there is,
and parking the whole lane for it would drop the lane's entire composite for the length of the
fade. One element going quiet leaves the other's picture — and the blend says which slots carry
one, so a side that has nothing this frame is simply the transparent texel.

## An unchanged frame is neither uploaded nor drawn

`texImage2D` of a full-frame picture is the dearest call a tick makes, and most ticks would repeat
it for nothing: a still, a caption, a paused shot, the whole picture with the transport stopped.
So each slot remembers the picture it was last handed (`src/frameGate.ts`) and an upload goes
through only when that changed:

| source | what says it changed |
|---|---|
| a `<video>` | its `currentSrc`, its `currentTime`, whether it has a frame yet — and a seek in flight always uploads, since the element still holds the old frame |
| a still, a caption | the object itself: one per decoded image, one per cue |
| a camera | nothing can tell, so it uploads every tick while its stream runs |

A change is followed by ONE more upload, because a decoder may present the frame a tick after its
position moved; a stamp is not proof of the pixels.

The draw is skipped as well when nothing was uploaded, the transport is stopped, and nothing the
frame reads moved: the playhead (motions, blend progress and `uTime` all follow from it), which
lanes show which slots, the audio levels the passes read, and a LUT landing. Coming back into
sight forgets all of it and draws anew.

A playing `<video>` still uploads on every animation frame — `currentTime` moves on each — so a
30 fps shot on a 60 Hz screen pays twice. `requestVideoFrameCallback` would say when a frame is
truly new, but whether it fires for an element parked invisible is the browser's call, and a
missed callback would freeze the picture.

## A frame allocates nothing it can keep

The loop runs at the display's rate, so a collection made per tick is garbage made sixty times a
second. The visible set, the blend, motion and effect maps and each lane's slot tuples belong to
the driver and are cleared and refilled. The drift readout is filled only once `debugState()` has
been read: the pane polls it only while profiling.

## Out of sight, nothing is drawn

The viewport is a pane, hidden rather than unmounted, and a hidden pane that composites at 60 fps
spends a GPU and a decoder per lane on nobody. The driver watches its host with an
`IntersectionObserver` — which reports a `display: none` pane as not intersecting — and while it is
out of sight every lane is parked once and the frame does nothing. The loop itself keeps running,
being what notices the return, and coming back reseeks every element as a transport seek does.

## The clocks

`clock.ts` holds two, and the compositor cannot tell which one it has — that is what keeps the
renderer independent of where its time comes from.

| | what it answers to |
|---|---|
| `EngineClock` | follows a playhead reported over a socket |
| `TransportClock` | is the authority itself, for a host with no engine |

Only the realtime driver needs `SeekingClock`. Drawing a frame just asks what second it is, while
chasing one with a `<video>` has to know when the answer stopped being **continuous**, so it can
hard-seek instead of nudging a `playbackRate` towards a target that moved.

`EngineClock` interpolates because the engine reports about 20 times a second: 50 ms of jitter is a
visible stutter at 30 fps, so a frame sets an anchor and wall time carries it forward. It reads `performance.now()` and never `Date.now()`:
the latter is the WALL clock, which an NTP correction or a daylight step can move backwards under a
running transport, and every reader here subtracts two readings, so a backwards step reads as the
picture jumping. It is also coarser. Monotonic is the whole requirement.

`TransportClock` is **unused in this repo** — k7 hosts the renderer and has an engine, so the
picture follows `EngineClock`. It is kept because the seam is the point: for a host with no device
whose sample position the picture must agree with, inventing an engine to keep time would be a whole
process running to hold a number. It has no drift to correct (there is no audio clock to drift
against), but it MUST still announce its own discontinuities — seeking and the play/pause edge both
fire `onSeek`, and a seek that stays quiet leaves the picture on the frame before it.
