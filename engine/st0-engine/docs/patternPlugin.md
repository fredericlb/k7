# PatternPlugin — the engine plays every Strudel lane

A strudel lane (`extends: "@meta/strudel-track"`, `strudel: algo/<name>.strudel`) compiles to a
lane headed by `PatternPlugin` (`studio_pattern`). The pattern's source travels in the document
(`PluginDoc.patternSource`), the engine evaluates it in an embedded QuickJS, and plays its events:
notes onto the lane's chain, sample one-shots into it. Nothing in the file service plays a pattern.

## Why the engine

A scheduler in another process than the thing that plays has to guess the playhead, write clips
ahead of it, prune them behind it and survive the socket between: every one of those is an edge
case, and a tunnel makes each one worse. Here the notes are placed against the transport the audio
thread is actually rendering, a lane keeps playing if the server or the tunnel goes, and an offline
render plays a pattern like anything else.

## Why QuickJS, and not Tidal

Tidal is Haskell evaluated at run time: a GHC toolchain beside the engine, and OSC out — the same
socket-and-look-ahead problem, local. Strudel is the same pattern language already, and its three
packages are plain JS. QuickJS is a small C interpreter that FetchContent builds like Faust.

Measured (M-series, Release): events identical to Node's on every pattern tried, boot 34 ms and
2 MiB per lane, a pattern evaluates in 0.6–3 ms, a quarter-cycle query in 0.2 ms mean, 0.6 ms
p99 — and **28 ms worst case**, a GC pause QuickJS offers no bound on.

## One mapping, two runtimes

`packages/song-strudel/src/events.ts` is the hap → event mapping, the pitch rules and `labelKey`;
`engineEntry.ts` is the API this side calls. Both are bundled into `engine/strudel/strudel.bundle.js`
(`scripts/gen-strudel-bundle.mjs`), which is generated AND committed so the engine build needs no
Node, then embedded as a byte array at build time. `engineEntry.test.ts` (Node) and
`tests/StrudelHost_test.cpp` (QuickJS) assert the same lane events on the same pattern.

## How lanes share a file

Every lane linking a file gets the whole file's events and keeps its own: those whose `.label()`
matches the lane's name, compared as `labelKey` slugs. The file's **first lane by name** is its
catch-all and also plays the unlabelled events and any label no lane claims — the compile passes
every lane the claimed labels (`patternClaimed`) and marks that one (`patternCatchAll`). The
compile cannot do better without running the pattern: a lane per undeclared label would need the
labels, and those are only known by evaluating it.

What that rules out: a separate track per undeclared label, and routing by an instrument
MODULE's name in `s()`. Declaring a lane named after a label is the way to give that part its
own chain and strip.

A lane whose label the pattern never plays is silent with a graph that looks right, so after every
load a non-catch-all lane probes the first 8 cycles and says so, naming the labels it did find.

## Samples

An event whose sound name resolves in the banks IS a sample; anything else is a note
(`SampleBanks.h`). The banks are the document's (`patternBanks`): the project's `samples/`, then
`$DIRT_SAMPLES`, then `$STRUDEL_SAMPLES`, as the file service sees them. In each, the WAVs in
`<name>/` sorted by file name and taken modulo `n`, else `<name>.wav`.

A bare-wired lane gets one plugin playing both. A lane wired apart gets a notes plugin heading its
`#midi` half and a samples plugin heading its `#audio` half, which classify identically since they
resolve against the same banks. A plugin that meets a kind nothing on its lane plays (only one half
wired) says so once per sound rather than dropping it silently.

One-shots are mixed INTO the buffer at the head of the chain, which is where clip audio enters: an
instrument after them on a bare lane overwrites them, the reason a kit and a synth on one lane want
the two halves wired apart. A sample plays to its end at its native rate (stepped, not converted, so
a device rate change costs nothing), scaled by the event's `gain`. A seek or a stop cuts it. Files
are read on the worker, published through atomic slots, and never freed while the plugin lives:
256 files and 64 voices per lane.

## The audio thread never waits on JavaScript or a disk

A worker queries a quarter second ahead into a lock-free ring (`PatternSchedule.h`); the audio
thread only plays what is queued. The quarter second is what absorbs the GC pause above.

Every seek, stop, transport start away from where the worker was, and tempo change starts a new
**epoch**: sounding notes are released, one-shots cut, and anything queued for the old timeline is
dropped rather than played. The worker polls every 10 ms, so the first event after a seek arrives
late — up to 30 ms late still plays, at the top of the block, rather than being skipped. A LOOP is a
seek too, which is the known cost: its first event can be a few ms late.

An **offline render** is not real time, so the look-ahead would fall behind: there the render thread
queries each block itself, and what the worker had queued is discarded so the two never both land.
A rendered sample lands on its exact grid sample. A rendered NOTE lands where the instrument puts
it: Tracktion's `FourOscPlugin` reads MIDI timestamps as whole samples while plugins are handed
seconds, so it snaps every note to the start of its 32-sample sub-block, pattern and clip alike.

## A save is in place; the rest is identity

The source is NOT part of the plugin's identity (`keyOf`): a changed source diffs as
`PatternChanged`, applied by setting the live plugin's `pattern` property, so a save re-evaluates
without restarting the lane. The file service re-sends the document when a file a lane plays is
saved (`patternFiles`). A source that fails to evaluate keeps the previous pattern playing and says
why, once per distinct error. Everything else — label, catch-all, claimed labels, what it plays,
the banks — is fixed at construction and part of `keyOf`.

## Guards

One QuickJS runtime per lane, capped at 64 MiB, and every call has a 250 ms deadline: a pattern
that loops forever or allocates without end fails its load and the lane keeps the previous one.

## Licence

`@strudel/*` is AGPL-3.0-or-later and is linked INTO the engine, which is GPLv3 (Tracktion). GPLv3
§13 permits the combination; the AGPL's network clause then applies to the engine as a whole.

## Not yet proven

The LIVE path — worker, ring, a real transport — is covered by `tests/PatternSchedule_test.cpp` and
not by a running engine. Before relying on it on stage: open a project with a pattern lane on a dev
engine, play, seek, loop, and save the pattern while it runs.

The banks are paths on the machine that COMPILES; an engine on another machine finds a sample only
where the same path exists there.
