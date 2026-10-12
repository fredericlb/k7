# Two curves, because one of them cannot answer "how loud is this"

`Waveform` draws its contour on an **absolute dB scale** — 0 dBFS at the top, `MIN_DB` at the
bottom, with a labelled grid at −20/−40/−60/−80/−100. A grid like that invites you to read a
level off it, so what is drawn on it has to be a level that can be read.

## Why RMS alone is not that level

RMS on a grid labelled in dBFS reads as a level meter, and it is not one: it is the *average*
level, not the loudest sample.

Measured on a real clip (`gtr_echo_0@40`, a guitar with a delay, after `track process … normalize`):

| what the file service hands the pane | max |
|---|---|
| `rms` | −10,4 dB |
| `peak` — what the file is | **−1,0 dB** |

So a clip normalised to exactly −1 dBFS has its tallest RMS column around −10 and looks
untouched: the normalise is correct, and RMS alone cannot show it. Nine dB is ordinary for a
plucked guitar and the gap is wider on anything percussive.

`regionWaveform` computes **both** — `peak` as a max, `rms` as a quadratic mean per display
bucket — and `WebWaveform` carries both over the wire.

## Why both, and not just the peak

Swapping `rms` for `peak` is one word and it would be wrong. The clip pane's **trim gate**
measures RMS (`trimWindow(wf.rms, …)`) and draws its threshold as a horizontal line on this same
axis. A curve that is not RMS leaves that line comparing itself against something it
does not measure — the guide and the act disagreeing, which is worse than a guide nobody has.

So: the peak goes down first, faint (`PEAK_ALPHA`); the RMS sits on top of it, solid. The solid
curve is the shape the eye follows and the one the gate is about; the faint outline around it is
how loud the material gets. The distance between them is the crest factor, which is a thing worth
being able to see.

Both take the same playhead clip and the same two colours, or the progress fill would stop at two
different places.

## One reduction, run twice

`contourYs` is a free function rather than the body of a memo for exactly this: the two curves
must be reduced the *same* way. Two curves on one axis that disagree about how they got there
are worse than one.

It has a step worth knowing about before asserting anything exact. Every bucket is averaged with
its two neighbours **in the dB domain** (`R = 1`) before columns are reduced. It takes the edge
off single-sample spikes, and it costs a lone transient real height: about 1 dB on a real
envelope of a couple of thousand buckets, and tens of dB on a synthetic one whose neighbours are
silence. `contour.test.ts` pins the properties — the gap between the curves, the scale being
linear in dB — and deliberately not the exact tops.

## Hosts

`Envelope.peak` is optional, and only st0's clip pane passes it. The rehearsal recorder and session views
and the médiathèque's song player have one envelope each and draw the solid curve alone.
