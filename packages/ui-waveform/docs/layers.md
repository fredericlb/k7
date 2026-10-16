# Why the envelope is rasterised once and blitted

`Waveform` draws everything on one canvas in one effect: background, dB grid, bar/beat grid,
detected events, annotations, the envelope, the threshold, the selection, the edit handles, the
markers, the playhead, and the labels on top. One effect, one draw order, easy to read.

**`currentTime` is in that effect's dependency list**, and in k7 the playhead comes off the
engine's 20 Hz state frame — so a clip editor open during playback runs the effect twenty times a
second. Its two most expensive pieces are the two that never change while the transport moves:

- a smoothing pass over **every envelope sample**, then one interpolated value per **pixel
  column** — both `O(samples)` / `O(width)`, both a pure function of the material and the box;
- `drawEnvelope` twice, grey then purple: each is `width - 1` `quadraticCurveTo` calls plus a
  `createLinearGradient`. At a 1200 px canvas that is roughly **4 800 curve segments per
  frame**, tracing the same two shapes over and over.

## How they stay out of the frame

Two things, and neither of them moves a pixel:

1. **`ys` — one y per pixel column — is a `useMemo`** keyed on the samples, the interval, the
   width, the duration and the height. The transport is not in that list, which is the point.
2. **Each contour is rasterised into an offscreen canvas of its own** (`envelopeLayer`), rebuilt
   only when `ys` or the box changes. The per-frame draw is `drawImage` twice — the second one
   clipped to the played portion, exactly where a traced contour would be clipped.

   Four, on a host that also passes a `peak` envelope: the same played/unplayed pair for the
   faint curve behind the solid one. Blits rather than traced contours, rebuilt only when the
   reduction changes — see [envelopes.md](envelopes.md) for why there are two curves at all.

The offscreens are sized in device pixels and the main context is already scaled by the DPR, so
the blit is 1:1 with the backing store and stays sharp.

**The draw order is a constraint on the whole arrangement**: the threshold line, the selection,
the markers and the labels are drawn *after* the purple fill and must stay on top of it. Moving
the progress fill onto an overlay canvas would be cheaper still — one CSS clip per frame instead
of a blit — but it would put the fill above the labels, and a translucent purple wash over the
bar numbers is a visible change, not a free one.

## What a frame costs

Two blits, the grids, and the label pass. The grids are one stroke per line and the labels are
laid out from `gridLines` on every frame. Neither shows up in a profile; if one does, they are
static between interactions and the same treatment applies.

**And not a backing-store reallocation.** The effect opens with

```ts
canvas.width = width * dpr;
canvas.height = HEIGHT * dpr;
```

guarded by a comparison, because assigning `width` is not a no-op when the value is unchanged: it
reallocates the canvas's backing store and resets the entire 2D context. This effect runs on
every engine frame, so unguarded that is twenty discarded allocations a second per open clip
editor, on a box whose size only changes when the window does.

Nothing therefore resets the context for free, so that is asserted instead: `setTransform`
re-establishes the transform each frame, every style is set before it is used, and each of the
three `setLineDash` calls restores `[]`. A style set and not restored leaks into the next frame.

## Still open: the playhead re-renders the host

`ClipWaveform` (k7's `WaveformView.tsx`) reads the transport with
`useEngineState((s) => s.playhead)` — a SELECTOR hook, so the component renders at the frame
rate and the draw effect runs with it. `usePlayheadFrames` is this repo's answer to exactly
that, and its own header says why: *"a selector hook here would put a render on the component at
the meter rate, and going from 20 Hz to 60 would then be three times the renders rather than a
smoother line."*

It cannot simply be swapped in here, because that hook hands you a number to write onto a **DOM
node**, and this component draws its playhead onto the canvas along with everything else. Doing
it properly means a thin overlay canvas carrying the playhead and the progress edge, which is
the same move [rejected above](#how-they-stay-out-of-the-frame) for the progress FILL — and rejected there for a
reason that does not apply to a one-pixel line: a translucent wash over the bar numbers is a
visible change, a hairline is not.

That is a design lot, not a patch. It is named in `docs/constat.md`.

## The host's side of the bargain

`Waveform` is `memo`'d, which is worth nothing unless its props hold their identity:

- the `events` / `annotations` / `markers` / `gridLines` defaults are **module-level constants**,
  not `= []` in the parameter list — a fresh array per render is a new identity, and fires the
  draw effect on every render of the host whether or not the transport moved;
- a host must not build `envelope={{ intervalMs, samples }}` inline. k7's `WaveformView` holds
  it in a `useMemo` keyed on the decoded waveform, and passes `currentTime` from a small leaf
  component (`ClipWaveform`) so the slice windows, transient markers and warp marks around the
  canvas do not re-render with the transport.
