# The playhead — why it is not drawn from the engine's frames

The engine reports its position every **50 ms** (`EngineHost::onState(cb, intervalMs = 50)`,
20 Hz). A screen draws every ~16 ms. Drawing the reported value verbatim therefore moves the
line on one frame in three and freezes it on the other two — and the frames do not even arrive
on a regular 50 ms beat, because between the message-thread timer that samples them (which also
drains the waveform taps and pumps the param watches on the same tick), the JSON, the socket,
the parse and React's scheduler, each one lands with a different delay.

That is the difference between *stepping*, which is regular, and *stutter*, which is not.

Measured over four seconds of simulated frames, with ±30 ms of arrival jitter on the 50 ms
cadence — the per-frame step of the drawn line:

| | frames that did not move | mean step | step σ | biggest jump |
|---|---|---|---|---|
| drawing the reported value | **141 of 210** | 16.4 ms | 23.5 ms | 50.0 ms |
| `playhead-clock` | **0** | 16.7 ms | **0.00 ms** | 16.7 ms |

## The rate is KNOWN, so the only unknown is the offset

`@studio/engine-browser/playhead-clock` is pure and testable;
`src/hooks/usePlayheadFrames.ts` binds it to React.

The protocol has `play`, `stop` and `seek` and no varispeed, so the transport advances at
exactly one second per second. (Not even on the decks: a pitch fader re-stretches the CLIP and
slips it, because *"there is one transport and two decks"*.) That single fact decides the whole
design:

```
transport(t) = offset + t          // t is local monotonic time; the rate is 1, not estimated
```

One unknown. Every frame is a measurement of it — `offset_i = playhead_i − arrival_i` — and the
noise is **one-directional**: a frame is sampled and then travels, so it always *understates*
the offset, by exactly its own transit time.

So the estimate is the **largest** sample in a bounded window: the frame that got here fastest,
with the rest discarded. It is the same reasoning NTP applies to round trips, and it is only
available because the rate is known — with an unknown rate these samples would have to be
regressed, noise and all.

What that buys is a drawn position that is a **straight line in local time**. There is no
per-frame correction to see, because a frame moves the offset and never the position, and the
offset barely moves.

The window is bounded (`WINDOW_MS`) for one reason: the engine's playhead advances on the AUDIO
clock — the interface's crystal — while `performance.now()` is the system one. They differ by
tens of ppm, so the true offset creeps. Ageing samples out absorbs it; at 100 ppm four seconds
of creep is 0.4 ms.

### Rollback

A frame further from the estimate than `SEEK_EPS` (0.3 s, the figure `ui-eyes`' `EngineClock`
already uses) is not a late packet — the transport moved. A seek, a loop wrap, a play from
elsewhere. Every sample in the window now describes a position that no longer exists, so the
window is **thrown away** and re-seeded from that frame alone, and the drawn offset goes with it.

Without the flush the max filter would be actively wrong rather than merely stale: a jump
*forward* makes every later sample smaller, so the old ones would win for a full window. That is
what the two rollback tests pin.

### What is left over

`SLEW` — the drawn offset chases the estimate at 2% of real time rather than stepping to it.
That is the only smoothing left, it applies to a number that changes rarely, and it is what
keeps the line monotonic when the estimate moves down.

Stopped, there is nothing to estimate: the frame IS the answer, and a scrub lands exactly where
it says.

### Measured against a PLL

The same feed, with realistic transit times (4 to 55 ms, never negative — a frame cannot arrive
before it was sampled):

| | step σ | lag behind the engine |
|---|---|---|
| a PLL: anchor + elapsed, error bends the rate ±10% | 0.23 ms | 8.9 ms, up to 10.0 |
| offset estimate | **0.00 ms** | **4.0 ms, flat** |

A PLL corrects toward every sample, so it converges on the *mean* latency. The estimator sits at
the *minimum* — 4.0 ms is the best transit in the feed, and no method can do better than how stale
the freshest thing you were told is.

One honest limit on the word "lag": this is distance from the engine's reported position, which
is not the sound leaving the interface. Output latency (buffer + driver) sits between them and
neither figure accounts for it.

## It draws without rendering

`usePlayheadFrames` subscribes to the engine store's **raw** `subscribe`, never
`useEngineState`. A selector hook here would put a render on the component per frame, and going
from 20 Hz to 60 would then be three times the renders rather than a smoother line — the exact
thing the external store exists to avoid (`@studio/engine-browser/docs/meters.md`).
`useTurntableDeck` reads the store the same way, for the same reason.

So a caller renders its element once and the callback writes to the node:

```tsx
const ref = useRef<HTMLDivElement | null>(null);
usePlayheadFrames(useCallback((sec) => {
  if (ref.current) ref.current.style.transform = `translateX(${x(sec)}px)`;
}, [x]));
```

The callback must be a `useCallback`. Its identity is the signal "my geometry moved, put the
line where it belongs **now**" — which matters while stopped, when no frame is coming to do it.
A zoom while paused would otherwise leave the line at the old pixel.

Two consequences of writing the DOM rather than rendering:

- The timeline's playhead is **hidden, not unmounted**, when the transport is outside the zoomed
  range. The callback needs a node to write to on the frame it comes back into view.
- The rAF loop runs only while the transport does, so a stopped project schedules nothing. A
  hidden tab stops rAF too; the store keeps feeding the anchor, so the first frame after the tab
  comes back is past `SEEK_EPS` and snaps. Correct by construction rather than by a special case.
- A **hidden pane** subscribes to nothing. Panes are hidden with CSS and never unmounted, so the
  shell says which one is drawn through `PaneVisible` (`src/paneVisible.ts`), and the hook skips
  its subscription and its loop while it is false. Showing the pane again re-reads the store and
  draws at once — the same path as a fresh mount. The lane meters read the same flag and select a
  constant while hidden, so the meter-rate frames render nothing behind another pane.

## Who is on it

| | |
|---|---|
| `TimelineTab` | `Playhead` (transform) and `RecordingClip` (**width** — it is a growing block, and only its right edge moves) |
| `Minimap` | `MinimapPlayhead` |
| `PianoRoll` | `RollPlayhead` |
| `SequencerPanel` | `StepPlayhead` — a transform and not `left`: `left` is layout, and it would relay out the grid of buttons twenty times a second |
| `AudioClipPanel` | `LiveWaveform` — the clip panel's own line, on the FILE's axis; see below |
| `WaveformView` | `ClipWaveform` — through `Waveform`'s `setTime` handle, which moves a CSS clip and a line and redraws no canvas (`packages/ui-waveform/docs/layers.md`) |
| `TakesView` | `TakesPlayhead`, one per row — the view itself renders on gestures only |

### The clip panel converts before it draws

`AudioClipPanel` is the one reader whose picture is not in song time. A waveform is a **file**, and
a window into it: its axis is file seconds. The transport speaks song seconds. What joins them is
the pair the panel is opened with — `placedAt`, the beat the event's window opens at in the
arrangement, and `act.from`, the second it opens at in the file — so beats elapsed since the one
land as seconds after the other. The conversion is `src/clipPlayhead.ts`, on its own so it can be
held to something without mounting anything.

**Outside the event it draws nothing new**: the line falls back to `act.from`, the head of what
this event plays. Not the picture's left edge
— that is out in the bar of context `frameOnEvent` leaves either side, and a mark parked there
reads as a playhead somewhere it never plays. `clipPlayhead` answers `null` rather than clamping,
so the fallback is the caller's choice and not a number pretending.

A warped clip is a known approximation, the same one the panel's ruler already states: a stretch
map bends time INSIDE the clip, and this reads the placement's grid — the frame, not the warp.

`LiveWaveform` is a **leaf**, and that is the same rule as the beat counter beside it taken the
other way round. It steers `Waveform` through the same handle as `ClipWaveform`, so even the leaf
does not render per frame. The counter subscribes at whole-beat granularity *because* re-rendering on every
frame would redraw the waveform; the mark that must move every frame is therefore put where its
re-render reaches nothing else — not the sidebar, not the ruler, not the trim menu.

## Who is deliberately NOT, and why

**`ViewportTab` is not a playhead.** `VideoCanvas` feeds `ui-eyes`' `EngineClock` — a clock that
already interpolates, and whose realtime driver needs the raw anchor to tell drift from a seek.
Putting a smoothed value in front of it would smooth twice and blunt exactly the discontinuity it
hard-seeks on.

It is not a React reader either. The frames reach the clock through a raw
`store.subscribe`, so no component re-renders on one: feeding a clock is not drawing, and a
selector hook on the pane would commit its whole subtree 20 times a second to do it. See
`picture.md`.

**`useMidiRecording`'s `beatNow()` is raw, and not for a timing reason.** Folding it onto this
clock would not degrade recorded timing: raw `anchor + elapsed` lags by whatever the last frame's
transit happened to be — 4 to 55 ms, mean ~14 — while the estimate sits flat at 4. It would
probably improve it.

What stops it being a tidy-up is that it changes where recorded notes land by a few milliseconds,
which is a musician-facing change and wants to be someone's decision, tested against a click. The
decks' `docs/hosting.md` holds the same paragraph, where `CueButtons` raises the identical
question.

**The decks are on it too**, which is why the clock lives in
`@studio/engine-browser/playhead-clock`: both k7 and the turntables plugin (`@studio/k7-plugins`)
depend on that package, and it is where the frames arrive.

A deck's clock is not the transport but its platter's needle, which runs at the platter's own
`Rate` — so the clock takes a RATE, 1 by default. Everything above holds at any known rate: the
frames still understate (overstate, running backwards) by their transit, so the least-delayed one
is still the best. A new rate re-bases the offset so the drawn position does not move
(`retimePlayhead`). How the desk feeds it — the rate it knows, the loops it folds, the stalls it
refuses to extrapolate — is `packages/k7-plugins/docs/turntables/needleClock.md`. What the desk
STORES, a cue, stays the raw needle.

`ui-eyes`' two clocks read `performance.now()` rather than `Date.now()`. The wall clock can step
backwards under a running transport (an NTP correction), and every reader subtracts two readings,
so a backwards step reads as the picture jumping.
