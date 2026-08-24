# Audit — stability and speed of the engine

A standing audit of `engine/moteur` itself. `docs/audit-moteur.md` at the repository root owns
the other half — everything that links a *surface* to this engine, over registries, relays and
gates. This page is about what happens once a message has arrived: the threads, the audio
callback, and the cost of loading a project.

Findings are ordered by severity. Each is either an invariant this engine holds — written down so
it is not broken again — or a numbered lot still open, and why.

## One graph build per apply, and it happens inside `applyFull`

`play` itself is cheap. `EngineHost::play` → `TransportControl::play` → `performPlay` →
`ensureContextAllocated()`, which is a **no-op when the context is already allocated**. A freeze on
the first play is therefore never in the play path — it is in what `applyFull` leaves behind it.

Every `insertPlugin` adds a child to the Edit's ValueTree, and that reaches
`Edit::restartPlayback()`:

```cpp
// tracktion_Edit.cpp:1188
void Edit::restartPlayback() { shouldRestartPlayback = true; if (! isTimerRunning()) startTimer (1); }
```

One millisecond later `Edit::timerCallback` calls `TransportControl::editHasChanged()` →
`ensureContextAllocated(true)` → `createPlayAudioNodes`, which prepares the **entire** graph
synchronously on the calling thread. Every plugin's `initialise()` runs again, every `WaveNode`
reopens its reader, and every `NamPlugin::initialise` re-runs `dsp_->Reset()` — which prewarms the
network.

So everything that can invalidate the graph — `buildLevelMeters`, `applyAllTrackInputs`,
`applyMetronome` — happens **before** the single `ensureContextAllocated()`, and whatever the
live-input pass still queues is drained inside `applyFull` by
`Edit::dispatchPendingUpdatesSynchronously()`, Tracktion's own verb for exactly this. Move one of
them after it and three things follow, the third being the one people feel:

- the graph is built **at least twice** per apply;
- the second build lands **after** `applyFull` returns, so it is outside the `[applyFull] total=`
  line and outside the `busy:false` the server has already broadcast — the log says the project is
  ready while the message thread is still building it;
- that second build runs on whichever message-loop turn comes next. In practice that is the one
  carrying the user's first `play`, which therefore queues behind a full graph rebuild.

The timing line's `inputs=` and `settle=` phases exist so the whole of it is measured, and so none
of it happens after anyone has been told the project is ready.

Two neighbours of the same stall:

**Enable the input devices once, not once per track.** `WaveInputDevice::setEnabled` rebuilds the
whole wave-device list and reallocates every Edit's graph — `InputTuner.h:60-64` records what that
costs, twenty inputs asked for by a menu polling at 8 Hz wedging the engine outright. Enabling per
track makes a twenty-input song pay twenty list rebuilds and twenty graph reallocations on every
full apply. `applyAllTrackInputs` enables the distinct channel sets once, then calls
`dispatchPendingUpdates()` a single time.

**And re-resolve the channel set after the rebuild lands.** Tracktion's own comment inside
`setEnabled` is `// do nothing now! this object is probably deleted..`, so every line of
`applyTrackInput` after an enable that actually fired would otherwise read through a dangling
`dev`.

**Rack samples are still decoded whole into RAM, late.** `SamplerPlugin::addSound` only adds a
ValueTree child and triggers an async update; the real work is `SamplerSound::setExcerpt`, which
does `audioData.setSize(channels, fileLength + 32)` and reads the file in 8 KB chunks with a 2 s
timeout each — **fully in memory, synchronously, on the message thread, on a deferred update**.
For a large rack this is the single biggest remaining first-load cost, and being an async update
it lands on the next message-loop turn, which is the same turn `play` wants. **Lot 3.**

## Real-time safety on the audio callback

Six `applyToBuffer` implementations plus `InputTuner`'s callback are the whole audio-thread
surface here.

**Nothing allocates on a block bigger than `prepare()` announced.** `DspGraph::process` and
`NamPlugin::applyToBuffer` both split such a block into prepared-size chunks rather than growing a
buffer with `setSize`; the control and analysis phases run once per chunk, which is finer-grained
rather than wrong, and NAM's gain ramp is sliced across chunks so the split is inaudible. On the
NAM side a resize is not a pointer bump: `dsp_->Reset()` reallocates the whole network's Eigen
matrices and prewarms it — thousands of samples of WaveNet/LSTM inference, on the audio thread,
fired the first time the device buffer grows.

**Locks.** `InputTuner` and `NamPlugin` both use `try_lock` and drop a block rather than wait —
correct. The remaining blocking lock is inside `juce::IIRFilter`, which is
`IIRFilterBase<SpinLock>`: both `setCoefficients` and `processSamples` take it, so recomputing
coefficients every block takes that lock twice per channel per block for a filter whose knob has
not moved. Coefficients are cached on their inputs, as `MixerPlugin` does. Moving to
`juce::dsp::IIR::Filter`, which is lock-free, is **Lot 5**.

**I/O and logging.** None reachable, and deliberately so. One landmine worth writing down:
`studio::warn()` does a `std::cerr << … << std::endl` **and** invokes a sink that dumps JSON and
does a blocking WebSocket send. Calling it from the audio thread would be catastrophic. It is
reached only from plugin constructors and the message thread — but `sessions.md` contemplates "a
warning raised from the audio thread's prepare", so the design imagines doing it. **Do not.**

**The audio side never writes the reader's cursor.** `WaveformTap::reset()` stores `lastRead_` —
the *message thread's* read cursor — and rewinds `writeHead_`, and `reset()` is called from graph
preparation and from transport repositioning. Wire it to `WaveformTapPlugin::reset()` and
`written - lastRead_` underflows, gets capped at the ring size by `drain()`, and reads back as a
full ring of stale points. `BroadcastTapPlugin` carries a comment saying precisely why it has no
`reset()`; the waveform tap resets only the writer's half-filled bucket.

## Crash risks

**`whoami` must not touch the live audio device.** The handler answers on the asking socket's own
thread on purpose — posting it would turn a latency probe into a measurement of the engine's queue
— and `getCurrentAudioDevice()` is what `setAudioDevice` destroys and recreates. The browser's
keepalive sends `whoami` every few seconds on every socket and the tray probes it several times a
second, so any interface switch overlapping one takes the process down. The message thread
*publishes* `{bufferFrames, sampleRate}` into two atomics whenever a device opens or changes, and
`audioTiming()` reads only those. The fast off-thread reply is unaffected.

**The plugin-cache memo is shared across threads, so it is shared safely.** `cachedPluginInfos()`
hands out a `shared_ptr<const vector>` under a mutex, and both callers hold that snapshot for as
long as they hold anything into it. A plain vector plus a plain bool cannot do the job: the memo is
invalidated from a **detached** scan thread and rebuilt on the message thread, while
`makeExternalPlugin` holds a raw `const PluginInfo*` into it across a dozen lines — a background
scan finishing mid-apply frees the buffer under it.

**Every transport call guards.** `transport()` returns null when `edit` is null, and `populateEdit`
dereferences `*edit` on the line before, so the case is reachable; the call in `applyFull` warns
and returns rather than dereferencing.

**`linmap(x, lo, hi)` checks the span.** `(a-b)/(c-b)` over a zero span is `0/0`, and `juce::jlimit`
does **not** filter NaN: both its comparisons are false, so the NaN comes straight out. It can then
reach `IIRCoefficients::makeBandPass`, which poisons the filter's state permanently —
`sanitiseValues` cleans the buffer, not `v1`/`v2`. Reachable from the shipped default auto-wah,
whose `lo` is itself computed by a `lerp`.

**A duplicate id is reported.** `index()` in the diff uses `map::emplace`, which keeps the first and
drops the rest **in silence**. A second entry sharing an id is built by `populateEdit` (which walks
the vector) and is then invisible to every later diff: it can never be updated or removed
incrementally, and `trackById` routes its changes to the first match instead. First-wins stays —
changing which one survives would change what plays — but it raises a warning naming the id.
Pinned by `diff_duplicate_id_is_reported`.

Two relatives of the same shape are **not** covered, and are listed here so they are known:
`EditBuilder::trackById` returns the first doc index matching an id, and `inputClients` is keyed
by device *name*, so an interface exposing one label twice gives both tracks the first one's
meter. **Lot 4.**

## Speed

**Build flags are the biggest single lever.** `CMakeLists.txt` sets no optimisation flags at all —
no `-O2/-O3`, no LTO, no FTZ/DAZ, no `-march` — so optimisation is whatever `CMAKE_BUILD_TYPE`
implies. `dev-gcc` and `dev-clang` are `RelWithDebInfo` for that reason; `asan` stays `Debug`, where
the report matters and the speed does not. At `-O0` NAM's Eigen inference, the `DspGraph`
interpreter and 186 AirWindows effects run several times slower than they ever will in production,
so "the engine is slow" measured on a `Debug` build is measuring the flags.

**Denormals need guarding by hand.** `grep ScopedNoDenormals` returns nothing in this repository
*and* nothing in Tracktion Engine 3.2.0. `juce::IIRFilter` snaps its own state to zero at block
boundaries, so the biquads and `MixerPlugin`'s shelves are safe by accident; the `adelay` circular
buffers, `awires_` and NAM's Eigen tensors are not — and a decaying feedback delay is the canonical
denormal generator. The symptom is an engine that gets slower the longer it plays. The plugins this
repository owns (`GraphDspPlugin`, `MixerPlugin`, `NamPlugin`) guard it; Tracktion's own reverb,
delay and the AirWindows set do not. Covering them needs FTZ/DAZ set once per audio thread, and
there is no hook we own to do it from. **Lot 6.**

**The `DspGraph` interpreter.** Five things it must not go back to doing:

| never | instead |
|---|---|
| `std::any_of` over every node, per block, to ask whether the graph contains a `mix` | `hasMix_`, answered at `build()` |
| recompute biquad coefficients every block (`sin`, `cos`, `sqrt` + two spin locks) | recompute only when frequency or Q moves |
| walk **every** node per sample and branch on its phase | `sampleNodes_`, the sample-phase indices in declared order |
| four integer `%` per sample per channel in `adelay` (~20-40 cycles each) | delay lines rounded up to a power of two, wrap by mask |
| call `buffer.getReadPointer(ch, start)` per sample per channel in the envelope | read pointers taken once, as the sample phase does |

Declared order is preserved, because a node reading a wire written later gets the previous
sample's value and that *is* the unit delay a feedback loop needs.

### Where the interpreter is deliberately left alone

The last row of that table is worth 3% of that one loop, and no more. The number is written down
because it is hard to get, and because the obvious ways of getting it are wrong.

**Measuring across two builds is not measuring.** Compile a hoist, rebuild, and the auto-wah reads
12% faster and the envelope-only graph 18% faster — and the **flanger 7% faster too, and the
flanger has no envelope node at all**. That is code layout moving under a recompile, not the
change. The honest form is both spellings compiled into one binary, timed against the same buffer
with the arms interleaved: 570 ns against 550 ns for one 256-sample stereo block, repeatable across
runs. So the compiler does not hoist it by itself, and what it costs is ~17 ns of a 5 333 333 ns
block budget.

**The other three phase walks are right as they are.** `analysis`, `audio` and `mix` each iterate
every node and skip on `n.phase`, and only the sample phase gets an index list. That asymmetry is
not an oversight: the sample phase walks **once per sample** — 48 000 times a second per node — and
the other three walk **once per block**, 187 times a second. A 256:1 difference, which is the whole
reason one of them is worth an index.

Measured by padding the auto-wah with inert control nodes: 188 extra nodes cost ~4.5 ns each per
block, and that figure *includes* each one's own arithmetic, so the skipping alone is a fraction of
it. On a real graph — the shipped ones are 4 to 12 nodes — the three skipped walks come to
something under 40 ns on a block that takes 2 800 ns. Three more index vectors on the class, for
0.0007% of the budget, is a worse class than it is a saving.

For scale, the shipped graphs cost 0.05% (auto-wah) and 0.24% (flanger) of real time per instance.
The flanger is five times the auto-wah because it is the one that runs per-sample dispatch — which
is the design working as `DspGraph.h` describes it, not a defect.

The analysis phase is what an `envelope` node exercises, and `DspGraph_test.cpp` pins it three
ways: the envelope follows the louder channel, either side, and a mono buffer reads one channel
without reaching the null second pointer. Verified red by making the loop read channel 0 twice.

**`Edit::setCountInMode` writes a file.** It looks like an Edit property and is not one: Tracktion
implements it as `engine.getPropertyStorage().setProperty(SettingID::countInMode, …)`, a
process-global entry flushed to the `%APPDATA%/Studio/Settings.xml` that `AGENTS.md` insists
nothing reads. `play()` shadows it and writes only when the mode changes.

Its other half is a real limit rather than a bug, and worth knowing: because the setting is
engine-global, **two sessions share one count-in**. That is survivable only because every `play`
asserts the mode it needs — which is why the call must stay next to the transport call and must
not be hoisted.

## Left as lots

Each of these is a design decision rather than a patch, which is why none is taken here.

1. **`TrackRemoved` is a stub** that does nothing while the diff reports it as applied. Removing
   a track from the song leaves its lane, its plugins and its clips playing until something else
   forces a full rebuild. `engineHost.md` documents the shape of that failure: the changelog says
   success, the audio does not move.
2. **`keyOf(PluginDoc)` folds in the preset path, the sidechain source and every rack entry**, so
   any change to one of those surfaces as remove+add rather than as a change to the live plugin:
   the module is re-instantiated and drops whatever state it held.
3. **Rack samples decoded whole into RAM on a deferred update** (above).
4. **The duplicate-key family** beyond the diff: `trackById`, `busForDest`, `inputClients`.
   `PluginParams` already solves it properly by disambiguating (`name + " #" + n`); that is the
   pattern to copy.
5. **`juce::IIRFilter` → `juce::dsp::IIR::Filter`**, to drop the last blocking lock on the audio
   thread.
6. **FTZ/DAZ per audio thread**, to cover Tracktion's own effects.
7. **The 20 Hz `state` frame is broadcast synchronously from the message thread** to every
   client, and IXWebSocket holds a per-socket write mutex for the whole send. `broadcast.md`
   names this hazard and it is live — one wedged client stalls the engine. The binary audio
   path escapes it via a dedicated sender thread; the JSON path does not.
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

Four suites, and each must be **named** to be built — the presets pin `targets: ["studio-moteur"]`.

What none of that says anything about: the `[applyFull]` line on a real project, and whether a
`play` issued the instant it appears is served immediately. That is the measurement this page
exists for, and it needs a browser.
