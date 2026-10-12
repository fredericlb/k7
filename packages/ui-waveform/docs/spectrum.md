# The spectrum look

`<Waveform look="spectrum">` draws the DJ desk's waveform: one column per pixel, mirrored about
the middle, as tall as its **linear peak** and coloured by **what is in it**: red for bass, green
for mids, blue for highs. **It is the look st0 uses everywhere**: the clip editor, the audio clip
panel, the blocks on the timeline and the desk's scrolling band. The médiathèque and the rehearsal pages keep the default
`contour`, the dB curve [envelopes.md](envelopes.md) argues for: there the question is how loud a
take is, and a dB axis answers it.

There is one painter, `spectrumColumns` in [spectrum.ts](../src/spectrum.ts), and every surface
goes through it. The desk asks it for a playhead-centric window and the shared canvas asks it for
a whole region, but a column comes out the same in both. A second painter would let the two
drift apart in colour or proportion without anyone noticing.

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
