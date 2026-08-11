# Why the envelope is rasterised once and blitted

`Waveform` draws everything on one canvas in one effect: background, dB grid, bar/beat grid,
detected events, annotations, the envelope, the threshold, the selection, the edit handles, the
markers, the playhead, and the labels on top. One effect, one draw order, easy to read.

The trouble is that **`currentTime` is in that effect's dependency list**, and in l8 the
playhead comes off the engine's 20 Hz state frame. So opening a clip editor during playback
re-ran the whole thing twenty times a second, and the two most expensive pieces of it were the
two that never change while the transport moves:

- a smoothing pass over **every envelope sample**, then one interpolated value per **pixel
  column** — both `O(samples)` / `O(width)`, both a pure function of the material and the box;
- `drawEnvelope` twice, grey then purple: each is `width - 1` `quadraticCurveTo` calls plus a
  `createLinearGradient`. At a 1200 px canvas that is roughly **4 800 curve segments per
  frame**, tracing the same two shapes over and over.

## What changed

Two things, and neither of them moves a pixel:

1. **`ys` — one y per pixel column — is a `useMemo`** keyed on the samples, the interval, the
   width, the duration and the height. The transport is not in that list, which is the point.
2. **Each contour is rasterised into an offscreen canvas of its own** (`envelopeLayer`), rebuilt
   only when `ys` or the box changes. The per-frame draw is now `drawImage` twice — the second
   one clipped to the played portion, exactly where the traced version was clipped.

The offscreens are sized in device pixels and the main context is already scaled by the DPR, so
the blit is 1:1 with the backing store and stays sharp.

**The draw order is unchanged.** That was the constraint on the whole exercise: the threshold
line, the selection, the markers and the labels are drawn *after* the purple fill and must stay
on top of it. Moving the progress fill onto an overlay canvas would have been cheaper still —
one CSS clip per frame instead of a blit — but it would have put the fill above the labels, and
a translucent purple wash over the bar numbers is a visible change, not a free one.

## What a frame still costs

Two blits, the grids, and the label pass. The grids are one stroke per line and the labels are
laid out from `gridLines` on every frame. Neither has shown up in a profile since; if one does,
they are static between interactions and the same treatment applies.

## The host's side of the bargain

`Waveform` is `memo`'d, which is worth nothing unless its props hold their identity:

- the `events` / `annotations` / `markers` / `gridLines` defaults are **module-level constants**,
  not `= []` in the parameter list — a fresh array per render is a new identity, and it fired
  the draw effect on every render of the host whether or not the transport had moved;
- a host must not build `envelope={{ intervalMs, samples }}` inline. l8's `WaveformView` holds
  it in a `useMemo` keyed on the decoded waveform, and passes `currentTime` from a small leaf
  component (`ClipWaveform`) so the slice windows, transient markers and warp marks around the
  canvas do not re-render with the transport.
