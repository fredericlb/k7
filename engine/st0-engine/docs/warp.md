# warp.md — how a clip's stretch map reaches the sound

A clip carries a **warp map**: a list of `[timeline beat, source second]` markers saying where
each moment of the file should land. `@studio/song` compiles it into `ClipDoc::warp`
(`packages/song/docs/warp.md` is the authoring half), `server/DocJson.cpp` parses it, and
`EditBuilder::applyClipWarp` is what turns it into Tracktion state.

The map does **two** things at once, and Tracktion realises them through two different
mechanisms. Keeping that straight is the whole content of this page.

| what | mechanism | set by |
|---|---|---|
| the OVERALL ratio — first marker to last | auto-tempo (`LoopInfo::setNumBeats`) | `clip.setAutoTempo(true)` |
| the re-timing BETWEEN those ends | the warp map (`WarpTimeManager`) | `clip.setWarpTime(true)` |

## `varispeed` is a different branch entirely

`WarpDoc.algorithm` was decorative until the DJ desk needed two behaviours out of one fader. On
`"varispeed"`, `applyClipWarp` takes none of what follows: no stretcher, no auto-tempo, no warp
map. It disables time-stretching and sets a **speed ratio**, which is a resample — the record
plays faster and goes UP in pitch, the way a platter does.

The ratio is inverted on the way in. `speedRatio` is source seconds per timeline second
(`getSourceLength() / speedRatio` is the clip's length), while the ratio computed above the branch
is the other way round, so the branch passes `1.0 / ratio`.

Two reasons this is worth a branch rather than an option somewhere.

**It is linear, and stretching is not.** A pitch-preserving stretcher decides its frames from the
signal, so stretching four separated parts independently does not give what stretching their sum
would. Resampling is the same combination of input samples whatever the input, so parts stay
summable. `packages/song-schema/docs/stems.md` has the measurements, and the DJ desk's default is this
one for that reason.

**Interior markers are refused by construction.** A constant speed cannot express a piecewise map,
so the branch returns before `WarpTimeManager` is touched. The desk only ever emits two markers;
a project importing a real warp map asks for `elastique` and gets the path below. Nothing checks
that a `varispeed` clip carries only two markers — the extra ones are simply ignored, which is the
one thing here that could surprise somebody.

A changed `algorithm` re-inserts the clip: `clipMoved` compares it, so flipping the desk's KEY
button really does swap the mode rather than leaving the old one running (`docs/projectDiff.md`).

## Why loop points do not work

Pinning each interior marker as a `LoopInfo` beat point does nothing to timing:

```cpp
li.addLoopPoint(sample, te::LoopInfo::LoopPointType::manual);   // <- no effect on timing
```

Each segment does *not* stretch on its own.
`AudioSegmentList::buildAutoTempo` walks the sync points and advances its beat cursor like this
(`tracktion_AudioSegmentList.cpp`, both the looping and the non-looping branch):

```cpp
beatPos = beatPos + BeatDuration::fromBeats ((seg.lengthSample / wi.sampleRate)
                                             * li.getBeatsPerSecond (wi));
```

`LoopInfo::getBeatsPerSecond` is **one constant for the file** — `numBeats` over its length. So
every segment is priced at the same rate no matter where the sync points fall: loop points decide
where the audio is **cut** (for crossfades and transposition), never how fast each piece plays.
Under auto-tempo alone a warp map is therefore flattened to its end-to-end ratio, and every point
the musician placed in between is silently discarded.

Silently is the operative word: both sides compile, the map reaches the engine intact, the clip
stretches by the right total amount, and the only symptom is that the middle of the clip does not
line up. That is the failure this page exists to prevent.

## `WarpTimeManager` is what carries the interior

`WarpTimeManager` is Tracktion's piecewise mechanism, and `EditNodeBuilder::getWarpMap` reads its
markers **straight into the playback graph** — `WaveNodeRealTime` wraps the file reader in a
`WarpReader`, which re-times per segment. No proxy, no pre-render.

Two things make it compose with auto-tempo rather than fight it.

**The map carries only the deviation from linear.** `getWarpMap` is computed *before* the
auto-tempo branch in `EditNodeBuilder` and passed *into* it, so both layers apply. Handing
`WarpTimeManager` the raw beat positions would therefore apply the overall ratio twice. Each
marker's warp time is instead where its beat falls once the map's span is spread evenly over the
file:

```
warpTime(i) = srcStart + (beat(i) - beatStart) / beatSpan * srcSpanS
```

The two endpoints come out identity by construction, so the warped stream is still `srcSpanS`
long and the `setNumBeats(beatSpan)` above it stays exact. Auto-tempo then applies the overall
ratio on top.

**`setUsesProxy(false)` must come first.** `WaveAudioClip::needsRender()` is
`warpTime && canUseProxy()`, so turning warp time on while proxies are still allowed would create
a `WarpTimeRenderJob` — a background render the headless renderer never pumps, which is the
documented way to make a render task loop forever. With the proxy already refused, `needsRender()`
stays false and nothing is scheduled.

A two-marker map still skips the whole path: it has no interior points, and an identity two-point
map is skipped earlier for the `buildAutoTempo` reason spelled out in [editBuilder.md](editBuilder.md).

## Verifying it

`scripts/warp-points.ts` is the proof, and it is a **render measured**, not a unit test — this is
timing you cannot check from TypeScript.

```
npx tsx engine/st0-engine/scripts/warp-points.ts
```

It writes a source of 1 kHz tone bursts at known seconds, renders it under two maps — one whose
ends are identity, so only interior points can move anything, and one that also compresses
overall, which is the shape a real recording's map has — and measures each burst's energy
centroid. It asserts both that the result is near the map and that it is at least three times
nearer the map than the straight end-to-end ratio; the second half is what actually discriminates.

Expect a residual of roughly 80 ms early on the first burst decaying to ~20 ms by the last. That
is the time-stretcher priming, not the mapping: a wrong mapping gives a constant or growing error,
not a decaying one. With the warp map disabled the render lands within a few ms of the straight
ratio, which is what a discarded map sounds like.

A burst is deliberately never placed at source second 0 — the head of the clip is inside the
stretcher's priming region, and a burst there reads ~40 ms early for reasons that have nothing to
do with the map.
