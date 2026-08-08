# Audit — stability and speed of the engine

A standing audit of `engine/moteur` itself. `docs/audit-moteur.md` at the repository root owns
the other half — everything that links a *surface* to this engine, over registries, relays and
gates. This page is about what happens once a message has arrived: the threads, the audio
callback, and the cost of loading a project.

Written 8 August 2026, after the report "the engine is unstable, and the first play freezes".
It was not one bug. Findings are ordered by severity; each says whether it is **fixed** here or
left as a numbered lot, and why.

## The headline: the first play freeze

`play` itself is cheap. `EngineHost::play` → `TransportControl::play` → `performPlay` →
`ensureContextAllocated()`, which is a **no-op when the context is already allocated**. So the
freeze was never in the play path. It was in what `applyFull` left behind it.

`applyFull` used to run in this order:

```
createSingleTrackEdit
populateEdit                    every plugin instantiated
ensureContextAllocated()        ← graph BUILD #1
buildLevelMeters                N+1 × insertPlugin
[applyFull] …ms                 ← the timing line printed HERE
applyAllTrackInputs
applyMetronome                  clickTrackEnabled
```

Every `insertPlugin` adds a child to the Edit's ValueTree, and that reaches
`Edit::restartPlayback()`:

```cpp
// tracktion_Edit.cpp:1188
void Edit::restartPlayback() { shouldRestartPlayback = true; if (! isTimerRunning()) startTimer (1); }
```

One millisecond later `Edit::timerCallback` calls `TransportControl::editHasChanged()` →
`ensureContextAllocated(true)` → `createPlayAudioNodes`, which prepares the **entire** graph
synchronously on the calling thread. Every plugin's `initialise()` runs again, every `WaveNode`
reopens its reader, and every `NamPlugin::initialise` re-runs `dsp_->Reset()` — which prewarms
the network.

Three consequences, and the third is the one people felt:

- the graph was built **at least twice** per apply;
- the second build landed **after** `applyFull` returned, so it was outside the
  `[applyFull] total=` line and outside the `busy:false` the server had already broadcast — the
  log said the project was ready while the message thread was still building it;
- that second build ran on whichever message-loop turn came next. In practice that was the one
  carrying the user's first `play`, which therefore queued behind a full graph rebuild.

**Fixed.** Everything that can invalidate the graph now happens before the single
`ensureContextAllocated()`, and whatever the live-input pass still queues is drained inside
`applyFull` by `Edit::dispatchPendingUpdatesSynchronously()` — Tracktion's own verb for exactly
this — so it is timed, and so it happens before anyone is told the project is ready. The timing
line grew two phases (`inputs=`, `settle=`) and now measures the whole thing.

Two further contributors to the same stall, both found while tracing it:

**`applyAllTrackInputs` enabled a device per track.** `WaveInputDevice::setEnabled` rebuilds
the whole wave-device list and reallocates every Edit's graph. `InputTuner.h:60-64` already
records what that costs — *"asked for twenty inputs by a menu polling at 8 Hz, wedged the engine
outright"* — but the lesson had been applied to metering only. A twenty-input song paid twenty
list rebuilds and twenty graph reallocations on every full apply. **Fixed**: the distinct
channel sets are enabled once, followed by a single `dispatchPendingUpdates()`.

That fix carried a second one. Tracktion's own comment inside `setEnabled` is
`// do nothing now! this object is probably deleted..`, and `applyTrackInput` went on to use
`dev` for eight more lines. When a device did have to be enabled, every line after it read
through a dangling pointer. It now re-resolves the channel set after the rebuild lands.

**Rack samples are still decoded whole into RAM, late.** `SamplerPlugin::addSound` only adds a
ValueTree child and triggers an async update; the real work is `SamplerSound::setExcerpt`, which
does `audioData.setSize(channels, fileLength + 32)` and reads the file in 8 KB chunks with a 2 s
timeout each — **fully in memory, synchronously, on the message thread, on a deferred update**.
For a large rack this is the single biggest remaining first-load cost, and being an async update
it lands on the next message-loop turn, which is the same turn `play` wants. **Lot 3.**

## Real-time safety on the audio callback

Six `applyToBuffer` implementations plus `InputTuner`'s callback are the whole audio-thread
surface here.

**Allocations — both fixed.**

- `DspGraph::process` grew `dry_` with `setSize` when handed a block larger than `prepare()` was
  told about. It now splits the block into prepared-size chunks; the control and analysis phases
  simply run once per chunk, which is finer-grained rather than wrong.
- `NamPlugin::applyToBuffer` did the same *and then called* `dsp_->Reset()`. That is not a
  pointer bump: NAM's `Reset` reallocates the whole network's Eigen matrices and prewarms it —
  thousands of samples of WaveNet/LSTM inference, on the audio thread, guaranteed to fire the
  first time the device buffer grew. The old comment called it "one allocation we then keep".
  It is now chunked like the graph, with the gain ramp sliced across chunks so the split is
  inaudible.

**Locks.** `InputTuner` and `NamPlugin` both use `try_lock` and drop a block rather than wait —
correct. The remaining blocking lock is inside `juce::IIRFilter`, which is
`IIRFilterBase<SpinLock>`: both `setCoefficients` and `processSamples` take it. Recomputing
coefficients every block therefore took that lock twice per channel per block for a filter whose
knob had not moved. **Fixed** by caching coefficients on their inputs, as `MixerPlugin` always
had. Moving to `juce::dsp::IIR::Filter`, which is lock-free, is **Lot 5**.

**I/O and logging.** None reachable, and deliberately so. One landmine worth writing down:
`studio::warn()` does a `std::cerr << … << std::endl` **and** invokes a sink that dumps JSON and
does a blocking WebSocket send. Calling it from the audio thread would be catastrophic. It is
currently only reached from plugin constructors and the message thread — but `sessions.md`
already contemplates "a warning raised from the audio thread's prepare", so the design imagines
doing it. **Do not.**

**A cross-thread write — fixed.** `WaveformTapPlugin::reset()` called `WaveformTap::reset()`,
which stores `lastRead_` — the *message thread's* read cursor — and rewinds `writeHead_`.
`reset()` is called from graph preparation and transport repositioning, so this was the audio
side writing the reader's state; `written - lastRead_` then underflowed, capped at the ring size
by `drain()`, and read back as a full ring of stale points. `BroadcastTapPlugin` carries a
comment saying precisely why it has no `reset()`; the waveform tap now resets only the writer's
half-filled bucket.

## Crash risks

**`whoami` read the live audio device off the message thread — fixed.** The handler answers on
the asking socket's own thread on purpose (posting it would turn a latency probe into a
measurement of the engine's queue), but `audioTiming()` dereferenced
`getCurrentAudioDevice()`, which `setAudioDevice` destroys and recreates. The browser's keepalive
sends `whoami` every few seconds on every socket and the tray probes it several times a second,
so any interface switch overlapping one could take the process down. The message thread now
*publishes* `{bufferFrames, sampleRate}` into two atomics whenever a device opens or changes, and
`audioTiming()` reads only those. The fast off-thread reply is unchanged.

**The plugin-cache memo was a data race — fixed.** `g_pluginInfoMemo` / `g_pluginInfoLoaded` were
a plain vector and a plain bool, invalidated from a **detached** scan thread and rebuilt on the
message thread, while `makeExternalPlugin` held a raw `const PluginInfo*` into the vector across
a dozen lines. A background scan finishing mid-apply freed the buffer under it.
`cachedPluginInfos()` now hands out a `shared_ptr<const vector>` under a mutex, and both callers
hold the snapshot for as long as they hold anything into it.

**A missing null check — fixed.** `applyFull` called `impl_->transport(session)->…` with no
guard, and `transport()` returns null when `edit` is null; `populateEdit` had already
dereferenced `*edit` on the line before. Every other transport call in the file guards. This one
now warns and returns.

**A divide by zero — fixed.** `linmap(x, lo, hi)` computed `(a-b)/(c-b)` with no check on the
span, and `juce::jlimit` does **not** filter NaN: both its comparisons are false, so `0/0` came
straight out. Worse, that NaN can reach `IIRCoefficients::makeBandPass`, which poisons the
filter's state permanently — `sanitiseValues` cleans the buffer, not `v1`/`v2`. Reachable from
the shipped default auto-wah, whose `lo` is itself computed by a `lerp`. Same family as the ring
a lane requested twice built empty.

**Duplicate keys taking a quiet path — reported now.** `index()` in the diff used
`map::emplace`, which keeps the first and drops the rest **in silence**. A second entry sharing
an id was built by `populateEdit` (which walks the vector) and then invisible to every later
diff: it could never be updated or removed incrementally, and `trackById` routed its changes to
the first match instead. It stays first-wins — changing which one survives would change what
plays — but it now raises a warning naming the id. Pinned by
`diff_duplicate_id_is_reported`.

Two relatives of the same shape are **not** fixed and are listed here so they are known:
`EditBuilder::trackById` returns the first doc index matching an id, and `inputClients` is keyed
by device *name*, so an interface exposing one label twice gives both tracks the first one's
meter. **Lot 4.**

## Speed

**Build flags were the biggest single lever, and were doing nothing.** `CMakeLists.txt` sets no
optimisation flags at all — no `-O2/-O3`, no LTO, no FTZ/DAZ, no `-march`. Optimisation was
whatever `CMAKE_BUILD_TYPE` implied, and `dev-gcc` — the preset `AGENTS.md` calls the default dev
build — was `Debug`, i.e. **`-O0`**. NAM's Eigen inference, the `DspGraph` interpreter and 186
AirWindows effects all built at `-O0` run several times slower than they ever will in production.
Any "the engine is slow" measured on a Linux dev build was measuring the flags. **Fixed**:
`dev-gcc` and `dev-clang` are `RelWithDebInfo`; `asan` stays `Debug`, where the report matters and
the speed does not.

**Denormals were unguarded everywhere.** `grep ScopedNoDenormals` returns nothing in this
repository *and* nothing in Tracktion Engine 3.2.0. `juce::IIRFilter` snaps its own state to zero
at block boundaries, so the biquads and `MixerPlugin`'s shelves were safe by accident; the
`adelay` circular buffers, `awires_` and NAM's Eigen tensors were not — and a decaying feedback
delay is the canonical denormal generator. The symptom is an engine that gets slower the longer
it plays. **Fixed** for the plugins this repository owns (`GraphDspPlugin`, `MixerPlugin`,
`NamPlugin`). Tracktion's own reverb, delay and the AirWindows set remain unprotected: covering
them needs FTZ/DAZ set once per audio thread, and there is no hook we own to do it from. **Lot 6.**

**The `DspGraph` interpreter.** Four things, all fixed:

| was | now |
|---|---|
| `std::any_of` over every node, per block, to ask whether the graph contains a `mix` | `hasMix_`, answered at `build()` |
| biquad coefficients recomputed every block (`sin`, `cos`, `sqrt` + two spin locks) | recomputed only when frequency or Q moves |
| the per-sample loop walked **every** node and branched on its phase | `sampleNodes_`, the sample-phase indices in declared order |
| `adelay` did four integer `%` per sample per channel (~20-40 cycles each) | delay lines rounded up to a power of two, wrap by mask |

Declared order is preserved, because a node reading a wire written later gets the previous
sample's value and that *is* the unit delay a feedback loop needs.

**A settings file rewritten on every play — fixed.** `Edit::setCountInMode` looks like an Edit
property and is not one: Tracktion implements it as
`engine.getPropertyStorage().setProperty(SettingID::countInMode, …)`, a process-global entry
flushed to the `%APPDATA%/Studio/Settings.xml` that `AGENTS.md` insists nothing reads. `play()`
called it unconditionally, twice over. It is now shadowed and written only when it changes.

Its other half is a real limit rather than a bug, and worth knowing: because the setting is
engine-global, **two sessions share one count-in**. That is survivable only because every `play`
asserts the mode it needs — which is why the call must stay next to the transport call and must
not be hoisted.

## Left as lots

Each of these is a design decision rather than a patch, which is why none was taken here.

1. **`TrackRemoved` and `PluginRemoved` are stubs** that do nothing while the diff reports them
   as applied. Removing a track from the song leaves its lane, its plugins and its clips playing
   until something else forces a full rebuild. `engineHost.md` already documents this failure
   mode from when `ClipMoved` had it: the changelog says success, the audio does not move.
2. **`needsFullRebuild` fires too widely.** `keyOf(PluginDoc)` folds in the preset path, the
   sidechain source and every rack entry, so any change to one of those becomes remove+add and
   therefore a full rebuild from scratch — exactly what `design.md` says the diff exists to
   avoid.
3. **Rack samples decoded whole into RAM on a deferred update** (above).
4. **The duplicate-key family** beyond the diff: `trackById`, `busForDest`, `inputClients`.
   `PluginParams` already solves it properly by disambiguating (`name + " #" + n`); that is the
   pattern to copy.
5. **`juce::IIRFilter` → `juce::dsp::IIR::Filter`**, to drop the last blocking lock on the audio
   thread.
6. **FTZ/DAZ per audio thread**, to cover Tracktion's own effects.
7. **The 20 Hz `state` frame is broadcast synchronously from the message thread** to every
   client, and IXWebSocket holds a per-socket write mutex for the whole send. `broadcast.md`
   names this hazard and it is still live — one wedged client stalls the engine. The binary audio
   path already escaped it via a dedicated sender thread; the JSON path did not.
8. **`Change` is a fat value type** — four `std::optional`s of whole docs, so a `PluginParamChanged`
   copies the entire `PluginDoc` (params map and rack vector) *per differing parameter*. A knob
   drag sending twenty params copies it twenty times.
9. **The hidden `__studio_preview__` track breaks the doc-index → lane mapping** for
   incrementally added tracks: after any preview, `TrackAdded` renames `getLast()` while
   `trackById` maps index *n* onto the preview lane.

## What a change here should be verified with

The build is fast and the suites are seconds; there is no excuse for a plan instead of a change.

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --target studio_engine_tests studio_session_tests \
      studio_midigraph_tests studio_dspgraph_tests --config RelWithDebInfo
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R studio_ --output-on-failure
./build/windows-msvc/RelWithDebInfo/studio-moteur.exe --list-audio-devices
```

Four suites, not the three `AGENTS.md` lists, and each must be **named** to be built — the
presets pin `targets: ["studio-moteur"]`.

What none of that says anything about: the `[applyFull]` line on a real project, and whether a
`play` issued the instant it appears is served immediately. That is the measurement this page
exists for, and it needs a browser.
