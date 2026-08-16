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
| `playheadClock` | **0** | 16.7 ms | **0.67 ms** | 17.6 ms |

## The clock is STEERED by the frames, not set from them

`src/playheadClock.ts` is pure and testable; `src/hooks/usePlayheadFrames.ts` binds it to React.

The frames are treated as a *measurement* of the position, not as the position. Local wall time
carries the line, and the error against the engine only bends its **rate**, by at most ±10%
(`RATE_SPAN`), absorbing a full correction over about half a second (`RATE_TAU`).

Re-anchoring on every frame — the obvious version — is the trap: it copies the timer's and the
socket's jitter straight back into the line, so you get 60 fps of stutter instead of 20. The
table above is exactly that comparison.

Two properties fall out of steering rather than snapping:

- **It never goes backwards while rolling.** The rate stays positive, so a frame arriving late
  cannot drag the line back over material that already played.
- **A real discontinuity still snaps.** A seek or a loop wrap is past `SEEK_EPS` (0.3 s, the
  figure `ui-eyes`' `EngineClock` already uses) and is taken whole — easing eight bars at 1.1×
  would take a minute.

Stopped, there is nothing to smooth: the frame IS the answer, and a scrub lands exactly where it
says.

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

**`ViewportTab` is not a playhead.** It hands `playhead` and `playing` to `VideoCanvas`, which
feeds `ui-eyes`' `EngineClock` — a clock that already interpolates, and whose realtime driver
needs the raw anchor to tell drift from a seek. Putting a smoothed value in front of it would
smooth twice and blunt exactly the discontinuity it hard-seeks on.

**`WaveformView`'s line lives inside a canvas.** `currentTime` reaches
`@studio/ui-waveform`'s `Waveform`, whose draw effect repaints the WHOLE canvas — grid, labels,
annotations, the two pre-rasterised layer blits — on every change, and `currentTime` also picks
the clip region for the played/unplayed progress fill. Feeding it 60 times a second would be
three times the canvas work for a smoother line: a pessimisation, not a fix. Doing it properly
means splitting the playhead out of that canvas onto a cheap overlay, in a package with several
consumers. Left alone on purpose.

**`useMidiRecording`'s `beatNow()` must stay raw.** It timestamps incoming MIDI notes, and it
re-anchors on every frame precisely because raw `anchor + elapsed` is the most accurate estimate
of where the transport *is*. This clock is deliberately not that: it trades accuracy for
continuity, bending its rate by up to ±10% so the eye sees no step. That trade is right for a
line and wrong for a note. **Folding these two together would silently degrade recorded timing**
— it is the one unification on this page that must not happen.

**The decks are on it now**, and the clock moved to `@studio/engine-browser/playhead-clock` to
get there — both l8 and `@studio/ui-turntables` already depend on that package, and it is where
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
