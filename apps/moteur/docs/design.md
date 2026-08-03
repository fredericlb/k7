# studio-moteur — design notes

The frontend is a separate **Node** app (`../brain`) talking to this C++ engine
over a WebSocket; YAML parsing lives in Node. These notes describe the engine.

## The pipeline

```
project JSON ──► ProjectDoc ──diff(old,new)──► ProjectDiff ──apply──► tracktion::Edit ──► audio
 (from brain)      (model)         (Phase 3)                (EngineHost)
```

One rule keeps it sane: **only `EngineHost` includes a Tracktion or JUCE
header.** Everything above it is plain data — diffable and unit-testable without
an audio device. The WebSocket server (`server/`) is likewise JUCE-free: it only
uses `EngineHost`'s `post()`/`onState()`/`run()` API.

## Phase 3 — diff & apply

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

### Status

Implemented incrementally: tempo, time sig, track add, rename, clip add. The
rest (`TrackRemoved`, `ClipRemoved/Moved`, plugins, automation) are explicit
stubs in `EngineHost::apply` with the exact engine call noted in a comment.

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

## Meters (wiring `trackLevelDb`)

`trackLevelDb` returns `-100` today. To make meters live, insert a
`LevelMeterPlugin`/`LevelMeasurer` per track in `applyFull`, and read its dB in
the accessor. It reads atomics written by the audio thread — safe to poll.
