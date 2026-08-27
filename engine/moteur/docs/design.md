# studio-moteur — design notes

Everything above this engine is **Node and TypeScript**: `@studio/song` compiles a folder of
YAML into a `ProjectDoc`, and `@studio/file-service` sends it over a WebSocket. YAML parsing
never happens here. These notes describe the engine.

## The pipeline

```
project JSON ──► ProjectDoc ──diff(old,new)──► ProjectDiff ──apply──► tracktion::Edit ──► audio
 (from @studio/song) (model)                              (EngineHost)
```

One rule keeps it sane: **only `EngineHost` includes a Tracktion or JUCE
header.** Everything above it is plain data — diffable and unit-testable without
an audio device. The WebSocket server (`server/`) is likewise JUCE-free: it only
uses `EngineHost`'s `post()`/`onState()`/`run()` API.

### The Tracktion pin, and the two namespaces

We are on **Tracktion Engine v3.2.0** (pinned in `CMakeLists.txt`). Model types are
`tracktion::engine` (aliased `te`), but the core time types — `TimePosition`,
`TimeDuration`, `TimeRange`, `BeatPosition` — are `tracktion` (aliased `tt`), **not**
under `engine`. If a tag bump stops compiling, the calls in `EngineHost.cpp` are the
ones to check: everything else in the project is engine-agnostic.

## Diff & apply

### Why not just rebuild the Edit on every save?

Rebuilding re-instantiates every plugin, drops their state (reverb tails, held
synth notes), re-allocates the graph on the message thread, and scales with
project size instead of edit size. So we compute the minimal changeset and apply
it in place.

### Stable identity is the whole trick

`diff()` matches entities across two docs by **id** (tracks required; clips and
plugins optional with a `source@start` / `type:path` fallback). A **rename** is
"same id, new name" → one `setName`, not remove+add. Nudging one clip in a
200-track song emits exactly one `ClipMoved`.

### Change ordering

`diff()` emits: global (sample rate → tempo → time sig) → track removals → track
adds (each followed by its contents) → per-track rename + clip/plugin/automation
deltas. `apply()` executes top-to-bottom without dangling references.
`SampleRateChanged` forces a full rebuild (the device reopens);
`needsFullRebuild()` detects it and falls back to `applyFull()`.

### What is incremental, and what is not

Every change kind but one is applied in place: tempo, time signature, master
volume, track add/rename/params/input, clip add/remove/move, plugin
add/remove/param/enable, and automation. `TrackRemoved` is the exception, and it
takes the whole diff to `applyFull()` alongside `SampleRateChanged`: `trackById`
maps a document INDEX onto a lane, so a lane outliving a shortened document moves
every later track's clips, mute and input onto its neighbour without saying so.
`docs/audit-stabilite.md` has the worked example.

## Threading & realtime rules (non-negotiable)

```
main / message thread                 audio thread (JUCE device callback)
─────────────────────                 ──────────────────────────────────
EngineHost::run() dispatch loop        pulls audio from the Edit's graph
apply() (mutate Edit) via post()  ──►  (never blocked, never allocates)
onState() timer snapshots              reads lock-free / atomic state only
```

- All `Edit` mutation happens on the message thread. The WebSocket network
  thread marshals via `EngineHost::post()` (→ `MessageManager::callAsync`).
- The audio callback must never lock, allocate, or log.
- `onState()` runs a message-thread `juce::Timer`; the server broadcasts its
  snapshots to WebSocket clients.

### `run()` is `runDispatchLoopUntil`, never `runDispatchLoop`

`EngineHost::run()` blocks the calling thread by looping on
`runDispatchLoopUntil(100)`, which drives `CFRunLoopRunInMode` directly. Plain
`runDispatchLoop()` would be wrong: on macOS that is `[NSApp run]`, and `NSApp` only
exists when `JUCEApplicationBase::main()` created it. We have our own `main()` and only
a `ScopedJuceInitialiser_GUI`, so `NSApp` is nil, `[nil run]` returns instantly, and the
engine would exit about 0.3 s after binding its port.

## Meters (`trackLevelDb`)

`buildLevelMeters` appends a `LevelMeterPlugin` per track after a rebuild, and
`trackLevelDb` reads its dB. That accessor reads atomics written by the audio
thread — safe to poll. A track with no meter reports the `-100` floor.
