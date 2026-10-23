# The spectrum look

k7 has ONE waveform: one column per pixel, mirrored about the middle, as tall as its **linear
peak** and coloured by **what is in it**: red for bass, green for mids, blue for highs. The blocks
on the timeline, the clip editor, the audio clip panel, the desk's scrolling band, the
médiathèque's song player, the rehearsal pages and the recorder's live take all draw it.
`<Waveform>` has no other look: a song reads the same on every screen, and a second look would
make the same file look like two different ones from one page to the next.

There is one painter, `spectrumColumns` and the `paintColumns` under it in
[spectrum.ts](../src/spectrum.ts), and every surface goes through it. The desk asks it for a
playhead-centric window, the shared canvas for a whole region and the recorder for the trailing
seconds of a take, but a column comes out the same in all three. A second painter would let them
drift apart in colour or proportion without anyone noticing.

## What each surface feeds it

The look reads the peak for a column's height and the three bands for its colour; it falls back
on the RMS `samples` for the height when there is no peak.

- **Anything the engine analysed** — a clip, a library song, a rehearsal song or version — has
  both, from its `.cache` sidecar (`packages/audio-probe/docs/waveform.md`). The library's
  `/api/mediatek/envelope` hands them on, and the rehearsal server keeps them in its stored shapes,
  measuring again a shape stored without a peak.
- **A take being recorded** has only the RMS the browser or the engine measures as it rolls, so it
  is drawn in grey (`PLAIN`, below) at its RMS height. So are a rehearsal session and its moments,
  whose envelope is that live RMS, stored.

The cost of one look is the dB axis: nobody reads a level off a k7 waveform. The trim gate and the
recorder's silence threshold still measure RMS, and their line is drawn at ±that amplitude on the
same linear axis, which on an analysed file sits under a peak-height picture.

## The colour is a blend, not a lookup table

[spectrumColour.ts](../src/spectrumColour.ts) blends the three band peaks the engine writes into
the sidecar (`packages/audio-probe/docs/waveform.md`). The mix is **additive**: bass red, mid green
and top blue blend like ordinary light, so bass with mid gives orange-yellow, bass with top gives
violet, and all three give white. The palette comes out of arithmetic rather than a table of
special cases.

- Each band leans towards its hue (bass towards orange, top towards violet) and keeps only a
  **weak** contribution in the two channels it does not own. If those contributions are too
  strong, bass with top comes out nearly white instead of violet.
- The mix is normalised by the **loudest** band, not by the sum. The colour says which band
  dominates, and it must read the same in a quiet passage and a loud one. Normalised by the sum,
  pure bass would draw at a third of its intensity and read as muddy brown.
- A file analysed without bands is drawn in plain grey (`PLAIN`). That reads as "not analysed
  that way", where a blank column would read as silence.

## A column is the MAX of what it covers

When zoomed out, several buckets land in one pixel column. `columnsOf` takes the **maximum** of
the peak and of each band over those buckets, and `regionWaveform` resamples a clip's region the
same way. Averaging would flatten a kick into its neighbours, and a kick is exactly what a peak
picture is for.

## Smooth, at the cost of the sharpest peak

Two passes keep the outline from reading as a bar chart:

- **Zoomed in**, a bucket is wider than a pixel, and repeating it draws flat steps. `interpolated`
  reads between bucket centres instead, so the outline slopes. The desk's band always sits in that
  case: eight seconds of a five-minute song is about two hundred buckets across a much wider band.
- **Every column** then goes through `smoothColumns` in the painter: a triangle `SMOOTH_RADIUS`
  columns wide on each side, over the amplitude and the three bands alike. Neighbouring columns
  stop flickering in height and colour.

The cost is that a single-column spike loses some height. That is acceptable because the zoomed-out
MAX above has already kept the kick, and the smoothing only spreads it over a few pixels.

## What this look drops

- **No dB axis and no dB labels.** The vertical scale is linear and mirrored, so a "−40 dB" line
  would sit in the wrong place. A `threshold` is drawn as two lines, at ±its amplitude.
- **No purple progress fill.** The part before the playhead is drawn from a dimmer layer
  (`PLAYED_ALPHA`), the convention of a DJ player's overview. The colour already carries the
  content, so a second hue would be fighting it.

## The timeline paints at bucket resolution

A timeline block paints its 160 buckets into a canvas 160 px wide and 100 px tall, and CSS
stretches that canvas to the block, the way a `preserveAspectRatio="none"` SVG would. A canvas sized
to the block would need a `ResizeObserver` per clip, and the timeline is the surface with the most
clips on it.

## A band that scrolls paints tiles, not columns

The desk's band shows the same track every frame, moved. `SpectrumStrip`
([spectrumStrip.ts](../src/spectrumStrip.ts)) rasterises the columns into tiles of `TILE_PX` once
per track and size, and a frame blits the one or two in view at an offset. Each tile is smoothed
with the columns either side of its edges, so two tiles meet without a seam. It keeps only the
tiles in view and their neighbours, and renders one neighbour ahead on a frame that rendered
nothing else, so crossing a tile edge costs no frame.

A blit lands on a whole device pixel: one resampled at a fractional offset blurs, and a blur that
changes every frame shimmers.
