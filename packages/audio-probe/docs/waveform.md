# `waveform.ts` — drawing a clip's region of a file

The heavy part of a waveform — decode and downsample — belongs to the C++ engine, which writes a
**placement-independent** `{source}.cache` sidecar per file. This module only reads it: it slices
that envelope to the region a clip plays and derives the bar/beat grid from the project's tempo,
so the picture lines up with the arrangement.

`FileEnvelope` therefore describes the FILE and nothing about any placement of it: a fixed-density
downsample, 0..1, plus the onsets the engine detected at that file's own resolution and the
sensitivity they were found with (per source, and sticky).

## Three bands, for colour

`low` / `mid` / `high` are the same envelope split for COLOUR — the way a DJ player draws a track.
Peaks per bucket, in the SAME bucket space as `peak`, so a consumer indexes all four the same
way. Split at 200 Hz and 4 kHz by complementary one-poles, so `low + mid + high` sums back to the
signal and a column's colour cannot invent energy it has not got.

They are optional because a sidecar written before v4 has none, and a surface that has them
should degrade to a plain envelope rather than to a blank one.

## `detectTransients` is the written spec, not the code that runs

It is mirrored byte-for-byte in `engine/moteur/engine/Waveform.cpp`, which is what actually runs:
the engine already has the decoded audio, so it detects while it is downsampling and writes the
result into the sidecar. Nothing in production calls the TypeScript any more; it stays because it
is the written spec, and `waveform.test.ts` is the contract both sides are held to — the same
arrangement `fileFingerprint` has. Changing it means changing both, and bumping the sidecar
version so existing caches rebuild.

## One mapping, handed out rather than re-derived

Everything drawn on a region goes through one file-second → display-second function, and
`RegionWaveform` hands it out (`toDisplay`) precisely so nothing rebuilds it. Anything else a
caller wants on the picture — the material's own `from`/`to`, say — must land in the same space,
and a second copy of `(sec - inPoint) * stretch` somewhere else is how the two come to disagree.

`sourceMap` is the two numbers that function IS, for a caller going the other way:
`display = (file − inPoint) × stretch`, so `file = display / stretch + inPoint`. A function
cannot cross a wire, and the browser needs the inverse the moment a GESTURE on the picture names
a moment of the source — a double-click placing a stretch point does exactly that. Sending the
pair keeps the rule true across the wire: there is still one mapping, and the far side applies it
rather than reinventing it from `offset`, `sourceFrom` and a tempo.

It carries `zeroBeat` with them. The map's beats are counted from the FILE's start while the
region's zero is the clip's in-point, and every `target` has had it subtracted; a caller naming a
beat must add it back. On an untrimmed clip it is 0 — which is why its absence was invisible
until a trimmed clip was warped.

## Where the clip starts in the source

TWO things add up, and only the second was ever read here: the clip file's own window
(`sourceFrom`, in seconds — see `AudioClipSchema`) and the placement's `offset`.
`placementToClip` puts an audio clip's in-point in the FIRST of them and leaves `offset` at 0, so
a drawing that read only `offset` began every trimmed clip at the file's head — the picture
showing one part of the take while the engine played another. The engine's own in-point is the
same sum (`clipPositionFor` in `EditBuilder.cpp`).

The display spans the clip's MUSICAL length, so a clip longer than its sample shows trailing
silence.

## Stretch: one ratio for a length, a piecewise map for a moment

`warpStretch` answers how many TIMELINE seconds one SOURCE second occupies — 1 when the clip is
not warped. It is the engine's own formula, deliberately: `applyClipWarp` (`EditBuilder.cpp`)
takes the first marker to the last, prices the beat span at the project tempo, and divides by the
source span. Only that ratio reaches Tracktion — the interior markers become beat points inside
it — so matching it here is matching what is actually heard rather than re-deriving a stretch of
our own. A marker pair is `[timeline beat, source second]`: two different clocks in one tuple,
which is why the two spans are computed apart and only then divided. A degenerate map says
nothing about the rate, and drawing the file at its own is the honest answer.

But `stretch` is the right answer to "how long is this" and the WRONG one to "where is this
moment". The engine pins every interior marker as a beat point, so each segment stretches on its
own; drawn with the overall ratio alone, a point pinned in the middle moved the sound and left
the picture exactly where it was. So a warped region asks the PIECEWISE map (`beatAtSource` /
`sourceAtBeat`) for every position, and keeps `stretch` only for counts — how many source frames
the region asks for, at the map's overall rate.

That is also why each column asks the mapping which audio it shows rather than stepping by a
constant `wantFrames / n`. A constant step is a straight line and therefore only correct while
the map is one; under a real map a column near a pinned point covers more or less source than its
neighbours, which is the whole of what "the waveform reflects the warp" means.

`zeroBeat` is where the clip's in-point lands, so display 0 stays the clip's start whatever the
map says.

## Warp marks: `orig === target`, and why the pair survives

The picture is warped, so a pinned moment is drawn exactly where it lands — there is no
displacement left to show, because it has been applied to the audio under it. The pair is kept
because a DRAG needs somewhere to put the target while the hand holds it, and the arrow between
the two is then the move being asked for rather than a state.

Both are region-relative. `target` used to be the absolute beat priced in seconds, which agreed
with `orig` only while the clip was untrimmed — the two origins differed by the in-point,
silently, on exactly the clips a warp is usually for.

Each mark carries `src`, the FILE second it pins, which is what `clip warp` and
`clip warp remove` address. Sent rather than left to be inverted: the mapping is piecewise, and a
surface that rebuilt it to name a point it can already see would be the second copy this page
keeps warning about.

## Transients are not detected per region

They are computed once per FILE, by the engine, and cached in the sidecar. This only maps them
onto the shown region, through the same `toDisplay` the marks and the envelope use.

Detecting per region was subtly wrong as well as repeated: a short clip resamples the envelope
UP, so the detector ran on interpolated detail the file never had, and the same audio drawn at
two sizes disagreed.

## The `whole` view is drawn WINDOWLESS

The same window that puts the picture in the right place also CROPS it, and there is one view
where that is wrong: the `whole` one, which exists to show the file the window is being judged
against.

`clip trim` writes seconds — numbers — and `mapClip` reads exactly those, so opening a trimmed
clip redrew the pane as the trim itself, with nothing left to see what had been cut. A TIMECODE
window survived it (`Number("2:1")` is NaN), so one field's two spellings drew two different
pictures. `WaveformOps` draws the whole view windowless for that reason.

Note that the two edges cut differently: `from` opens the region and shortens the span, while
`to` blanks what lies past it and leaves the span alone. That asymmetry is why a trimmed clip's
pane looked like a different take rather than like a shorter one.

## Bars

Bars are in quarter-note beats, so a bar is `numerator × 4/denominator` — 6/8 gives 3, 2/2 gives
4. An odd-over-8 like 7/8 gives 3.5, which a whole-beat grid can only approximate: a pre-existing
limit of the model, not of this file.
