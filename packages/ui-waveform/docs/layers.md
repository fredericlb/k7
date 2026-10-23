# Why the envelope is rasterised once and blitted

`Waveform` draws in one effect, in one draw order: background, bar/beat grid, detected events,
annotations, the envelope, the threshold, the selection, the edit handles, the markers and the
labels on top. The playhead is not in that effect, and neither is anything it moves (below).

The effect's most expensive pieces are the ones that never change while the transport moves:

- reducing the envelope to **one column per pixel** (`columnsOf`), the max of every bucket a
  column covers, then a smoothing pass over the columns — a pure function of the material and the
  box;
- painting those columns, one coloured `fillRect` each, twice: bright, and dimmed for the played
  side ([spectrum.md](spectrum.md)).

## How they stay out of the frame

Two things, and neither of them moves a pixel:

1. **`cols` — one column per pixel — is a `useMemo`** keyed on the envelope's fields, the width
   and the view. The transport is not in that list, which is the point.
2. **Each side is rasterised into an offscreen canvas of its own** (`spectrumLayer`), rebuilt
   only when `cols` or the box changes. The per-frame draw is `drawImage` twice — the second one
   clipped to the played portion.

The offscreens are sized in device pixels and the main context is already scaled by the DPR, so
the blit is 1:1 with the backing store and stays sharp.

## The transport moves CSS, not pixels

The transport comes off the engine at 20 Hz and is steered at 60 (k7's `docs/playhead.md`), so
nothing it moves may cost a redraw. The picture is three stacked canvases and a line, in paint
order:

1. **base** — the ground (background, grids, window, events, annotations) and the WHOLE material;
2. **played** — the same ground again with the played layers over it, clipped from the right by a
   CSS `clip-path` at the playhead (`src/playhead.ts`);
3. **the line** — a 2 px `div`, moved by a transform;
4. **the interactive canvas** — transparent, carrying the threshold, the selection, the edit
   handles, the markers, the onsets, the warps and the labels, and every pointer handler.

The played canvas repeats the ground so that, where it shows, it covers the base exactly, and
each side of the playhead gets ONE layer: the dim one over the bright would still read bright. The labels and marks stay above the fill because they live on
the top canvas, which is what forbids putting the fill on a canvas of its own ABOVE everything.

A host on the engine's frames passes no `currentTime` and steers `ref.setTime(seconds)` instead,
so neither it nor `Waveform` renders per frame; a host with its own clock (an `<audio>` element)
may keep passing `currentTime`, which takes the same CSS path.

## What a redraw costs

One blit per canvas, the grids twice, and the label pass — paid when the material, the
box, the view or a mark changes, never per frame.

**And not a backing-store reallocation.** The effect opens with

```ts
canvas.width = width * dpr;
canvas.height = HEIGHT * dpr;
```

guarded by a comparison, because assigning `width` is not a no-op when the value is unchanged: it
reallocates the canvas's backing store and resets the entire 2D context, three times per redraw
here, on a box whose size only changes when the window does.

Nothing therefore resets the context for free, so that is asserted instead: `setTransform`
re-establishes the transform each frame, every style is set before it is used, and each
`setLineDash` call restores `[]`. A style set and not restored leaks into the next frame.

## The host's side of the bargain

`Waveform` is `memo`'d, which is worth nothing unless its props hold their identity:

- the `events` / `annotations` / `markers` / `gridLines` defaults are **module-level constants**,
  not `= []` in the parameter list — a fresh array per render is a new identity, and fires the
  draw effect on every render of the host whether or not the transport moved;
- a host must not build `envelope={{ intervalMs, samples }}` inline. k7's `WaveformView` holds
  it in a `useMemo` keyed on the decoded waveform, and steers the transport from a small leaf
  component (`ClipWaveform`) through the handle, so nothing around the canvas renders with it.
