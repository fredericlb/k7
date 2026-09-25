# PatternPlugin — a Strudel lane the engine plays itself

A strudel lane marked `clock: engine` (on its node file, beside `strudel:`) is played by
`PatternPlugin` (`studio_pattern`), at the head of the lane's notes half. The pattern's source
travels in the document (`PluginDoc.patternSource`), the engine evaluates it in an embedded
QuickJS, and the notes reach the lane's instrument like any other MIDI. A lane without the key is
streamed by the file service's `PatternClock`, unchanged (`packages/song-strudel/docs/patternClock.md`).

## Why the engine, and why opt-in

The Node clock schedules from the server, across the tunnel, against a playhead it interpolates,
and speaks to the engine in clips it must write, prune and delta. Every edge case it carries —
a delta aimed at a document the engine no longer holds, `switchTo`, the last session owning the
clock — is the price of the scheduler being in another process from the thing that plays. Here
the notes are placed against the transport the audio thread is actually rendering, and a lane
keeps playing if the server or the tunnel goes.

It is opt-in per lane because the engine resolves **no sample names**: every event plays as a
NOTE, pitched by `notePitch` (`note`, else `n` from middle C, else the GM drum map for `bd`, `sn`,
`hh`…). A kit lane therefore wants a rack or sampler on its chain. Name → file resolution
(`samples.ts`) and the lanes the Node clock MINTS for undeclared labels stay on the Node side.

## Why QuickJS and not Tidal

Tidal is Haskell evaluated at run time: a GHC toolchain beside the engine, and OSC out — the same
socket-and-look-ahead problem, local. Strudel is the same pattern language already, and its three
packages are plain JS. QuickJS is a small C interpreter that FetchContent builds like Faust.

Measured on the spike (M-series, Release): events identical to Node's on every corpus pattern,
boot 34 ms and 2 MiB, a pattern evaluates in 0.6–3 ms, a quarter-cycle query in 0.2 ms mean,
0.6 ms p99 — and **28 ms worst case**, a GC pause QuickJS offers no bound on.

## One mapping, two runtimes

`packages/song-strudel/src/events.ts` is the hap → event mapping, the pitch rules and `labelKey`.
The Node clock imports it; `engineEntry.ts` imports it too and is what the engine bundles. So the
two cannot drift by construction, and `engineEntry.test.ts` (Node) and `tests/StrudelHost_test.cpp`
(QuickJS) assert the same lane notes.

The bundle is generated and COMMITTED (`engine/strudel/strudel.bundle.js`,
`scripts/gen-strudel-bundle.mjs`), then embedded as a byte array at build time — the engine build
needs no Node, and a regenerated bundle rebuilds without a reconfigure. Regenerate it after
touching `events.ts` or `engineEntry.ts`.

## The audio thread never waits on JavaScript

A worker queries a quarter second ahead into a lock-free ring (`PatternSchedule.h`); the audio
thread only emits what is queued. The quarter second is what absorbs the GC pause above.

Every seek, stop, transport start away from where the worker was, and tempo change starts a new
**epoch**: sounding notes are released at once and anything queued for the old timeline is dropped
rather than played. The worker polls every 10 ms, so the first note after a seek arrives late —
up to 30 ms late still plays, at the top of the block, rather than being skipped. A LOOP is a seek
too, which is the known cost of this version: its first note can be a few ms late.

An **offline render** is not real time, so the look-ahead would fall behind: there the render thread
queries each block itself, and whatever the worker had queued is discarded on the first block so
the two can never both land. Measured against the same notes written as a MIDI clip through the
same synth, a rendered pattern lands within 8 samples on every note.

## A save is in place; a label is identity

The source is NOT part of the plugin's identity (`keyOf`): a changed source diffs as
`PatternChanged`, applied by setting the live plugin's `pattern` property, so a save re-evaluates
without restarting the lane. The file service re-sends the document when an engine lane's
`.strudel` file changes (`enginePatternFiles`). A source that fails to evaluate keeps the previous
pattern playing and says why on the warning channel, once per distinct error.

The LABEL — the lane's name, matched the way the Node clock matches a `.label()` — is identity:
it decides which events the plugin plays, for its whole life.

## Guards

One QuickJS runtime per lane, capped at 64 MiB, and every call has a 250 ms deadline: a pattern
that loops forever or allocates without end fails its load and the lane keeps the previous one.

## Licence

`@strudel/*` is AGPL-3.0-or-later and is now linked INTO the engine, which is GPLv3 (Tracktion).
GPLv3 §13 permits the combination; the AGPL's network clause then applies to the engine as a
whole, as it already did to the file service that runs the same packages.

## Not yet proven

The LIVE path — worker, ring, a real transport — is covered by `tests/PatternSchedule_test.cpp`
and not by a running engine. Before relying on it on stage: open a project with a `clock: engine`
lane on a dev engine, play, seek, loop, and save the pattern while it runs.
