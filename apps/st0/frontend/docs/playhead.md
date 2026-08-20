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
what the two rollback tests pin, and they were verified red by keeping the window.

### What is left over

`SLEW` — the drawn offset chases the estimate at 2% of real time rather than stepping to it.
That is the only smoothing left, it applies to a number that changes rarely, and it is what
keeps the line monotonic when the estimate moves down.

Stopped, there is nothing to estimate: the frame IS the answer, and a scrub lands exactly where
it says.

### Measured against the version this replaced

The same feed, with realistic transit times (4 to 55 ms, never negative — a frame cannot arrive
before it was sampled):

| | step σ | lag behind the engine |
|---|---|---|
| a PLL: anchor + elapsed, error bends the rate ±10% | 0.23 ms | 8.9 ms, up to 10.0 |
| offset estimate | **0.00 ms** | **4.0 ms, flat** |

The PLL converged on the *mean* latency, because it corrected toward every sample. The estimator
sits at the *minimum* — 4.0 ms is the best transit in the feed, and no method can do better than
how stale the freshest thing you were told is.

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

## Who is on it

| | |
|---|---|
| `TimelineTab` | `Playhead` (transform) and `RecordingClip` (**width** — it is a growing block, and only its right edge moves) |
| `Minimap` | `MinimapPlayhead` |
| `PianoRoll` | `RollPlayhead` |
| `SequencerPanel` | `StepPlayhead` — moved off `left` onto a transform while we were here; `left` is layout, and it was relaying out the grid of buttons twenty times a second |

## Who is deliberately NOT, and why

**`ViewportTab` is not a playhead.** `VideoCanvas` feeds `ui-eyes`' `EngineClock` — a clock that
already interpolates, and whose realtime driver needs the raw anchor to tell drift from a seek.
Putting a smoothed value in front of it would smooth twice and blunt exactly the discontinuity it
hard-seeks on.

It is not a React reader either, any more. The frames reach the clock through a raw
`store.subscribe`, so no component re-renders on one: feeding a clock is not drawing, and the
pane used to commit its whole subtree 20 times a second to do it. See `picture.md`.

**`WaveformView`'s line lives inside a canvas.** `currentTime` reaches
`@studio/ui-waveform`'s `Waveform`, whose draw effect repaints the WHOLE canvas — grid, labels,
annotations, the two pre-rasterised layer blits — on every change, and `currentTime` also picks
the clip region for the played/unplayed progress fill. Feeding it 60 times a second would be
three times the canvas work for a smoother line: a pessimisation, not a fix. Doing it properly
means splitting the playhead out of that canvas onto a cheap overlay, in a package with several
consumers. Left alone on purpose.

**`useMidiRecording`'s `beatNow()` is still raw — but the reason given here was wrong.**

This page argued, twice and forcefully, that folding `beatNow()` onto this clock would *silently
degrade recorded timing*, because the clock traded accuracy for continuity. That was true of the
clock it replaced. The rate-bending PLL corrected toward every sample and so converged on the
**mean** transit latency; this one converges on the **minimum**. Measured on a realistic feed,
raw `anchor + elapsed` lags by whatever the last frame's transit happened to be — 4 to 55 ms,
mean ~14 — while the estimate sits flat at 4.

So folding them would not degrade MIDI timing. It would probably improve it. What stops it being
a tidy-up is that it changes where recorded notes land by a few milliseconds, which is a
musician-facing change and wants to be someone's decision, tested against a click. Recorded here
rather than quietly done, and the same paragraph now sits in the decks' `docs/hosting.md`, where
`CueButtons` raises the identical question.

**The decks are on it now**, and the clock moved to `@studio/engine-browser/playhead-clock` to
get there — both st0 and `@studio/ui-turntables` already depend on that package, and it is where
the frames arrive.

That move corrected a guess this page used to make. The decks were said to need the clock
generalised over a RATE, because a turntable has a pitch fader. They do not: the pitch fader
re-stretches the CLIP and slips it (`slipAfter`), and the transport still advances at one second
per second — *"there is one transport and two decks, so moving it to hold one deck still would
throw the other"*. The clock needed nothing.

What the decks did need was the split above, a second time. `MixView`'s `transportNow` fed two
callers at once: the record's wedge (looked at) and `CueButtons`, whose `began.current = now()`
is the position a cue is STORED at. So `Deck` now asks for both — a raw `playhead` ref and a
steered `drawNow` — and `docs/hosting.md` says which is for what. The deck's waveform lost its
own copy of the extrapolation along the way, and with it the `playing` test it used to decide
whether to extrapolate: the clock holds still while stopped by itself, so the two can no longer
disagree about what "stopped" means.

`ui-eyes`' two clocks did get one fix: they read `performance.now()` now rather than `Date.now()`.
The wall clock can step backwards under a running transport (an NTP correction), and every
reader subtracts two readings, so a backwards step read as the picture jumping.
