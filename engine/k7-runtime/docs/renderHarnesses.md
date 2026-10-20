# The render-and-measure harnesses

Three scripts under `engine/k7-runtime/scripts/` prove something about the SOUND by rendering a
document and measuring the wav: `warp-points.ts` (a clip's interior warp map), `pad-effects.ts` (a
sequencer pad's `repeat` and `skip`) and `quick-master.ts` (what `QuickMasterPlugin` claims). They
exist because the claim is a fact about a live `te::Edit`, which the four C++ suites build none of
and which no TypeScript test can see.

They all cost a real render, so none of them is in `ctest` or in vitest. They run on GitHub
instead, in the `harnesses` job of `.github/workflows/images.yml`: after every engine build on
`main`, against the binary that build put in the `k7-runtime` image, beside `render-once.ts`,
`master-chain.ts` and `cue-bus.ts`. That job reports and does not gate the image's tags, since
these tolerances were set on developers' machines and a shared runner has not yet proven it holds
them. `nam-rate.ts` is not among them: it measures a `.nam` model it is handed. Run them by hand:

```
npx tsx engine/k7-runtime/scripts/warp-points.ts
npx tsx engine/k7-runtime/scripts/pad-effects.ts
npx tsx engine/k7-runtime/scripts/quick-master.ts
```

What follows is the measurement method, which is the hard part. The subject matter itself lives
elsewhere: [warp.md](warp.md), [quickMaster.md](quickMaster.md), and
`packages/song/docs/padEffects.md`.

## Measure what the process does not smear

Each harness picks a statistic the thing under test cannot distort in the direction of a pass.

**`warp-points.ts` measures each burst's energy CENTROID, not its onset.** A time-stretcher smears
a burst's edges, and it smears them further the more it stretches, so a threshold crossing reads
early by an amount that varies per segment. The centroid of the same energy does not move under a
symmetric smear, which is what makes a tight tolerance honest rather than a tolerance chosen to fit
the answer. The source is 1 kHz bursts on silence for the same reason: an envelope survives
time-stretching where a click does not.

The bursts start at 1, 3, 5 and 7 seconds — off every marker and off sample 0. One sits in the
middle of each segment, so a burst measures the INTERPOLATION rather than a pinned point, and none
is inside the stretcher's priming region at the head of the clip.

**`pad-effects.ts` counts ISLANDS of energy with a Schmitt trigger, not onsets.** Gating the
envelope instead finds 2 hits in a bar of 16 and reads as a broken engine: a synth's release runs
into the next note, so there is no silence for a gate to find. The measurement is armoured on both
sides. The synth is given a 30 ms percussive amp envelope, so every hit is loud and then genuinely
silent; and the trigger's two thresholds sit far apart (0.3 and 0.05 of the loudest hop), so a
decay tail crossing back and forth cannot ring it twice. Counting islands then needs no judgement
about what an "attack" looks like.

The envelope is RMS per 5 ms hop, never peak. A peak envelope tracks the waveform itself, so a
sustained tone makes it wobble once per period — at 65 Hz that is a rise every 15 ms, and a flux
test reads 28 attacks in a bar of 4. RMS over a window longer than the period is flat while a
note holds, which is the property the whole measurement rests on. The test note is C5 rather than a
kick-range C2 for exactly that reason: the measurement, not the music, chooses the pitch.

A pad is a whole beat long, which puts a ×4 ratchet's hits 125 ms apart — far enough that the
refractory window can swallow a doubled reading of one attack without swallowing a real hit.

**`quick-master.ts` measures the side/mid RATIO, not the side level.** The limiter sits after the
spreader, so widening can push into it and pull the whole render down; an absolute side level would
then read a wider image as a narrower one.

## Give the render headroom, and check that you did

`quick-master.ts` pans its two tracks hard apart — which is what gives the render a SIDE signal to
widen or collapse — and turns them DOWN 12 dB. The bounce is 24-bit PCM, so a hot render clips at
the format and every measurement afterwards compares two clipped waveforms. At −12 the plugin's
default ceiling never engages, which is what makes "neutral leaves the mix alone" a real claim
rather than an artefact. The first check the script runs is that the BARE render has headroom, so
this cannot quietly stop being true.

Every harness reads and writes wavs through `scripts/wav.ts`, one reader for all of them. It takes
16/24/32-bit PCM and float32 rather than pinning one: the bounce's format is the engine's to
choose, and a harness that fails on it tells you nothing about the plugin. It walks the RIFF chunks
instead of assuming a 44-byte header, because a float wav carries `fmt ` with an extension and often
a `fact` chunk, so the fixed offset lands mid-sample.

## Ask for a value the parameter can actually take

`quick-master.ts` drives the ceiling to −12 dB with 12 dB of drive: 18 dB of limiting, far more than
a one-pole attack can take off a transient, so the line tests the safety clipper as much as the
limiter. A peak above the ceiling there means the ceiling is an intention rather than a guarantee.

−12 is the FLOOR of that parameter's own range, and asking for less is how this line lies: an
out-of-range value is clamped by the `AutomatableParameter`, so `Ceiling: -18` measures −12 dBFS
and reads as a limiter 6 dB out.

The neutral run is its own case, and it is what catches the LR4 allpass correction in `splitBands`
going missing: without it there is a several-dB notch around the low corner, which shows up as a
neutral render quieter than the bare one.

## Prove discrimination, not just proximity

`warp-points.ts` uses a 100 ms tolerance, which is loose, and says so. The measured error is about
80 ms early on the first burst and decays to ~20 ms by the last — a transient of the stretcher's
priming, not the constant offset a wrong mapping would give — and it is the floor of what a
stretched render can be measured to here.

A loose tolerance is only honest because a second check carries it: every burst must be at least
three times nearer the warp map's prediction than the straight end-to-end ratio's. Being NEAR the
map proves little on its own; being three times nearer the map than the ratio is the actual claim.

Its two cases exist for the same reason. The first has identity ENDS — beat 16 is second 8 at that
tempo — so `applyClipWarp`'s auto-tempo layer stretches by exactly 1.0 and every difference belongs
to an interior point. The second has the shape a real recording's map has: squeezed overall AND
re-timed inside. Auto-tempo does the first, the warp map the second, and that case is the one that
fails if the two are made to apply the same ratio twice.

`pad-effects.ts` checks the same way. A ratchet on the first pad only should raise a pass from 4
hits to 7, and the other three pads must be untouched — an effect that leaked onto its neighbours
would raise the total too and would still look right in a count alone. It also checks that the four
hits divide the PAD's own length rather than running past it into the next step, and it runs
`repeat` and `skip` together on one pad, which is the case a naive expansion gets wrong by skipping
single hits instead of whole passes.

## `master-chain.ts`: prove the plugin RAN, then prove the number

A fourth harness, `engine/k7-runtime/scripts/master-chain.ts`, checks that a master chain and the OUT
node's own trim both reach the sound. It makes two different kinds of claim and measures them
differently on purpose.

The chained case pins Tracktion's own volume plugin to the **bottom of its fader**. Silence is the
one outcome that cannot be a coincidence, since nothing else in the document touches the level — so
that check is a MARGIN rather than exact silence: the fader's own curve decides the floor, and the
question being asked is only whether the plugin ran at all.

The parameter is `Volume`, capitalised, which is the name the plugin publishes
(`packages/song-schema/src/builtinParams.generated.json`). A lowercase key matches nothing and
changes nothing, silently, which is the failure this case is shaped to catch.

The trim case is the opposite. `MasterGainPlugin` takes dB straight to a linear factor with no
curve, so the trimmed render must land EXACTLY `TRIM_DB` below the bare one, within half a dB. That
tolerance is rounding rather than slack: anything looser would also pass on a render that ignored
the field and clipped.

## Naming a built-in in a document

`quick-master.ts` writes `type: "Quick Master"` — the DISPLAY name — rather than the C++ class name.
`enginePlugin()` turns it into `{ type: "Quick Master" }` on the wire and `resolveBuiltInType`
matches it to `studio_quickmaster`. That is how a document names any built-in, and it is the same
vocabulary AirWindows names arrive in.
