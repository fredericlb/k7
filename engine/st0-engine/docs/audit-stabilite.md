# Audit — stability and speed of the engine

A standing audit of `engine/st0-engine` itself. `docs/audit-moteur.md` at the repository root owns
the other half — everything that links a *surface* to this engine, over registries, relays and
gates. This page is about what happens once a message has arrived: the threads, the audio
callback, and the cost of loading a project.

Findings are ordered by severity. Each is either an invariant this engine holds — written down so
it is not broken again — or a numbered lot still open, and why.

## A warning has to reach a HUMAN, not stderr

An invariant rather than a lot, and it is here because a diagnostic nobody reads is the same
failure as a diagnostic nobody writes.

Stderr is invisible in the normal case: the supervisor **adopts** an engine it did not spawn, so nothing
captures its output. That is how a Neural Amp Modeler silently refusing its model — *"unsupported
version 0.7.0"*, the one line that explained why the plugin passed audio through untouched — cost
an afternoon. The plugin was in the chain, the module looked healthy, and the only evidence was on
a pipe nobody was holding.

So `warn()` writes stderr **and** hands the warning to whatever sink is installed; the server
installs one that broadcasts to every connected client. stderr comes first and unconditionally,
because the sink can throw, be absent, or belong to a client that has gone away, and none of that
may cost the log its line. `Warning::subject` is what the warning is ABOUT — usually a `PluginDoc`
id, `"chain:module"` — so a surface can attach it to the thing on screen instead of dumping a
string in a corner.

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
whole wave-device list and reallocates every Edit's graph — `docs/inputTuner.md` records what that
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
it lands on the next message-loop turn, which is the same turn `play` wants. **The lot below.**

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

**A stop and a panic reach the plugins on the message thread.** `te::midiPanic` runs every
plugin's `midiPanic()` and `reset()` on its caller's thread, and `EngineHost::stop`/`panic` call it
from the message thread while the graph plays. So every plugin here answers with an atomic flag and
clears its state at the top of its next block — `docs/panic.md` has the rule and the one exception,
NAM. Clearing in place is not a glitch but a crash: the arpeggiator divides by its held count, and
a stop zeroing it mid-block is an integer division by zero.

**Nothing prints on the audio thread, including code we fetch.** Faust's `poly-dsp.h` writes to
stderr on every voice steal, unconditionally; `engine/patches/faust.cmake` removes it at fetch time
(`docs/faust.md`). A print there takes the `FILE` lock and a `write(2)`, and on an adopted engine's
undrained pipe it blocks the callback for good.

**Locks.** `InputTuner` and `NamPlugin` both use `try_lock` and drop a block rather than wait —
correct. No filter takes one: `juce::IIRFilter` is `IIRFilterBase<SpinLock>`, locking on every
`setCoefficients` and `processSamples`, so the mixer, the master and the graph's biquads run
`Biquad.h` instead — its arithmetic operation for operation, the per-block snap to zero included, for
one thread and without the lock. A render through the mixer's EQ and the whole master chain is
bit-identical to the one before. Coefficients are still cached on their inputs.

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
keepalive sends `whoami` every few seconds on every socket and the supervisor probes it several times a
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

Its relatives are closed at the source: a document's repeated ids are renamed `id#2`… as it is read
(`docs/protocol.md`), so `trackById`, the send buses and `pluginsById` never meet two; and input
meters are keyed by device name AND physical channels, so an interface exposing one label twice
meters both (`docs/meterClients.md`).

## Speed

**Build flags are the biggest single lever.** `CMakeLists.txt` sets no optimisation flags at all —
no `-O2/-O3`, no LTO, no FTZ/DAZ, no `-march` — so optimisation is whatever `CMAKE_BUILD_TYPE`
implies. `dev-gcc` and `dev-clang` are `RelWithDebInfo` for that reason; `asan` stays `Debug`, where
the report matters and the speed does not. At `-O0` NAM's Eigen inference, the `DspGraph`
interpreter and 186 AirWindows effects run several times slower than they ever will in production,
so "the engine is slow" measured on a `Debug` build is measuring the flags.

**Denormals are flushed for the whole graph by Tracktion.** `DeviceManager::audioDeviceIOCallbackWithContext`
calls `FloatVectorOperations::disableDenormalisedNumberSupport()` on entry (FTZ/DAZ for that
thread), and its worker pools do the same, so Tracktion's own reverb and delay and the AirWindows
set are covered. It is not visible to `grep ScopedNoDenormals`, which is why it is worth writing
down. The `ScopedNoDenormals` in the plugins this repository owns stays: an offline render and a
test harness run them on threads the device callback never touches, and a decaying feedback delay
is the canonical denormal generator.

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

## A lane is found by its index, so the index must never lie

`trackById` maps a document **index** onto a lane:

```cpp
for (size_t i = 0; i < doc.tracks.size(); ++i)
    if (doc.tracks[i].id == id) { ... return tracks[(int)i]; }
```

So a lane left standing under a document that got shorter puts **every later track one lane off**.
Delete the first of three and the doc is `[B, C]` while the Edit is still `[A, B, C]`:
`trackById("B")` hands back **A**, and every clip insert, mute, input wiring, arm and meter reading
lands on the wrong lane, silently. `applySoloMute` and `inputLevelsDb` walk the same correspondence.

Hence the three things that rebuild: a track REMOVED, the tracks REORDERED, and a track INSERTED
before a kept one (`TracksReordered` covers the last two). A rebuild replaces the Edit and stops the
transport, on verbs that change the shape of the song anyway. A track ADDED at the end does not: its
lane is made before the change loop, in document order, the hidden preview lane is taken out of the
way, and every lane is then found through the NEW document — which, those three being rebuilds,
agrees with the old one on every kept track. Measured, a track with its clip and two modules goes in
in 26 ms with the transport rolling, against 146 ms and a stopped transport for the rebuild
(`docs/projectDiff.md`). `diff_track_removed_forces_rebuild`, `diff_track_reorder_forces_rebuild`,
`diff_track_inserted_mid_song_forces_rebuild` and `diff_track_added_at_end_is_in_place` pin it.

## Sends are part of the diff

A send's level, a send added, and a muted track that sends — a ROUTING rather than a muted lane —
are wired once, by the build. Left out of the diff, each would be an empty diff: unheard until
something else rebuilt. `SendPlan.h` decides the buses once for both the builder and the diff;
a changed routing signature is a rebuild, a level alone is set on the live aux send. Measured live:
a send moved from 1.0 to 0.5 under a playing tone gives exactly 0.75 of the level, as `~ a: send
level`, with no stop; and the four send shapes render identically before and after the plan
(`docs/projectDiff.md`, `docs/editBuilder.md`).

## A module that LOADS something reloads it in place

A preset, a NAM model and cabinet, a platter's record and a second input are loaded into the live
instance (`PluginReloaded`), not re-created, so a tail, a needle or a chain position survives the
edit. Measured: a record swapped under a playing deck triples the level on cue, and a NAM model
swapped under a playing amp keeps sounding, neither stopping the transport. Only what a constructor
builds — a Faust program, a jsdsp graph, a pattern's shape — or a file DROPPED is a replace
(`docs/projectDiff.md`).

## A rack edit decodes what changed, and nothing under the audio lock

Tracktion's `SamplerPlugin` rebuilds its whole sound list on any change, each sound decoding its file
in its constructor, and then calls `sourceMediaChanged()`, which decodes every one AGAIN while holding
the lock its `applyToBuffer` takes: a dropout on every rack build and every rack edit, as long as the
rack's audio takes to read. `engine/patches/tracktion.cmake` makes the constructor size the excerpt
only, decodes what no old sound holds, moves the rest's buffers under the lock in O(1), and drops the
refresh. With a rack now RELOADED in place rather than replaced, remapping one of eight 90-second pads
stalls the message thread 1 ms instead of 181, and the audio stream's longest gap is its idle 12 ms
instead of 30 (`docs/projectDiff.md`).

## An exception on the socket costs that client its connection, silently

The other invariant, and the one that was measured rather than reasoned about.

IXWebSocket has **no `catch` anywhere in it** — grep the checkout. `nlohmann`'s `value(key, default)`
throws `type_error.302` on a field of the wrong type and `type_error.306` on a message that is not a
JSON object at all, and both are reachable from any client: `[]`, `null`, `"hi"`, or
`{"type":"transport","action":5}`. The handler had a `try` around `json::parse` and around
`docFromJson` only, so everything else threw straight into the library.

What that costs is not a crash, which is what makes it bad. Measured against the pre-fix binary, on
two ports side by side:

| | pre-fix | with the catch |
|---|---|---|
| reply to the malformed message | none | `{"type":"error","message":"malformed message: …302…"}` |
| `whoami` afterwards **on the same socket** | none, ever | answered |
| close frame | none | none — the socket stays up |
| engine process | alive | alive |

The connection thread unwinds and that socket is **dead while still looking open**: no error, no
close, so nothing on the client side triggers a reconnect. The tab keeps a live WebSocket that will
never answer again. Worse, the `Close` handler never runs either, so the socket's entries in
`listeners`, `drivers` and `subscribers` are never retired, and it stays in `server.getClients()` —
which is exactly what the sender thread prunes against, so a dead socket can go on being handed
3 Mbit/s of audio.

Hence the one `try/catch` wrapping the whole dispatch, and why `onMessage` is a named lambda rather
than an inline one: the wrapper needs something to wrap.

## No thread the engine depends on waits on a peer

IXWebSocket's server sockets send **blocking**: `send()` spins until the peer has drained what it
was given, and gives up only on a socket error or a timeout — and both of its timeouts, the send
one and the ping, default to *never*. A peer that stops reading without closing — a laptop lid, a
stalled tunnel — is therefore a thread parked for as long as the peer stays. If that thread is the
message thread, every apply, transport command, recorder drain and watchdog stops for every session
while the audio plays on, which looks exactly like a hang.

Two things hold it off. `Serve.cpp` builds the server with a ping (`kPingIntervalSecs`) and a send
timeout (`kSendTimeoutSecs`), so a stuck peer is closed and the Close handler retires it. And no JSON
is sent from the thread that produced it: `Outbox.h` queues it for one writer thread, which skips a
state frame for a socket already behind (it is superseded twenty times a second) and never skips a
reply. The audio stream has had its own sender thread all along. What remains is that a stuck peer
delays the OTHER clients' JSON by up to the send timeout, since the writer serves them in order.
Measured with a client that pauses its socket while a second one floods `list-audio-devices`, whose
replies are broadcast:

| | no deadline, sends on the message thread | deadline only | deadline and outbox |
|---|---|---|---|
| `list-sessions` from the second client | never answered in 34 s | answered from 10 s on | answered from 6 s on |
| the stuck peer | stays connected | closed, `Send timeout` | closed, `Send timeout` |

**Nothing is deflated.** IXWebSocket offers permessage-deflate, but this build never agrees to it:
the handshake answers a browser's offer without the extension header, and wire bytes equal payload
bytes (measured at 1.004 with the header overhead). The audio stream costs its raw 350 KB/s per
listener and no compression CPU — so that is not where to look for the sender thread's time.

## The message thread never waits on the parameter-query lock

`pluginParamsOf` holds `paramQueryMutex` while it enumerates a plugin's parameters, and a VST3's
`getText` takes a `MessageManagerLock` — so that detached thread waits for the message thread while
holding the lock. The orphan map (`orphanPluginIfLoaded`, which the message thread reads to open an
orphan's window or snapshot it) therefore has its own mutex, held for a lookup and nothing else.
Sharing the query lock was a deadlock between a client opening a window and anyone listing a
plugin's parameters.

## Every thread that can throw has a net, and every thread is waited for

An exception out of a `juce::Thread`, a message callback or a detached `std::thread` is
`std::terminate`, and each of those runs code a user's content reaches:

- **`EngineHost::post` wraps every posted job** and turns an exception into a warning. The
  `project` job catches its own as well, so the client that saw `busy:true` also sees it end.
- **The pattern worker** catches around `feed`, and `StrudelHost::laneEvents` reads each field only
  when it is a finite number — nlohmann's `value()` throws on a key that is present but `null`, and
  a NaN in the bundle becomes exactly that through `JSON.stringify`. A one-shot's header is refused
  past a minute at 192 kHz rather than trusted to size a buffer.
- **The state timer and the turntable loader** catch around their body: neither is a posted job, so
  `post`'s net does not cover them, and a throw in the loader would also skip the count an offline
  render waits on.
- **`warn()` catches around its sink**: it is called from destructors and worker threads, and the
  sink serialises to JSON, which throws on bytes that are not UTF-8. The sink is cleared as soon as
  the message loop ends, since it holds `serve()`'s broadcast verbs by reference.
- **The detached threads a message starts** (a scan, a parameter list, an orphan load, the startup
  warm-up) each run inside a `try`, and go through a counter, and `serve()` waits for them after closing the server: each one
  captures `serve()`'s locals by reference. One still running after the grace — a plugin load can
  hang outright — makes the process leave through `_Exit` rather than free what it holds. On
  Android, where that would take the app with it, the wait is unbounded; nothing there loads a
  binary plugin.
- **A signal only raises a flag**, which the sender thread turns into `quit()`: `quit()` posts a
  message, which allocates and locks, and a signal handler may do neither.
- **A plugin scan's reader is not joined.** A process the plugin started can hold the child's
  stdout after the child dies, and then EOF never comes; the reader shares ownership of the child
  and its output, and the scan waits for it three seconds before counting that plugin as failed.
- **An offline render resets its Edit and drains the queue on every return**, through a scope
  guard, not only on the success path — the `AsyncPluginDeleter` crash AGENTS.md describes.

## Recorder nodes

A stop needs the NODE, not the plugin: `setRecorderRecording(…, false)` works on a node whose plugin
has left, and `attachRecorderTaps` — which runs after an incremental apply as well as a rebuild — files the take
of a node that left mid-take, then keeps the node one more pass so the state frame reports the take.
The same pass is what gives a recorder added in place its ring.

`RecorderTap::drain` checks for a lap again after it copies: a reader pre-empted mid-copy can be
lapped while it reads, and the frames that fell behind are zeroed and counted, which is the one
thing `damaged` promises (`docs/recorder.md`).

## What the audio thread reads, and what it never lets through

- **Tempo and time signature** come from `tempoSequence.getInternalSequence()`, the one view
  Tracktion makes safe during audio callbacks — never from `getTempo(0)`, whose `TempoSetting`
  objects the message thread owns and rebuilds. The pattern plugin reads both halves of the
  signature from one snapshot, so they cannot tear.
- **MIDI buffers the audio thread appends to are reserved on the message thread**, and the MIDI
  graph COPIES between its buffer and Tracktion's rather than swapping them, since a swap hands the
  reserve away and takes Tracktion's capacity in return.
- **A NaN stops at `QuickMasterPlugin`, when a project places it**: it zeroes non-finite input
  before its biquads, which would otherwise latch it, and before the limiter, whose `jmax` and
  `jlimit` both let it through. A Faust program's NaN is zeroed at its output and the instance
  cleared on the next block.
- **±Inf stops at every plugin's output, like NaN.** Tracktion sanitises each plugin's output, but
  for NaN only, so an Inf from a gain, a feedback loop or an external plugin flowed on and turned
  the next biquad's state into NaN — a track, or the whole master, then silent until a reset. The
  fetch-time patch (`engine/patches/tracktion.cmake`) makes the test `isfinite`, which covers our
  own plugins, the master gain included, as much as anyone's.
- **NAM prewarms a loaded model before swapping it in**, so the lock covers a pointer swap and the
  bridge's buffers rather than thousands of samples of inference (`docs/namPlugin.md`).

## Cost on the message thread

- **A plugin's identity carries a Faust program or a jsdsp graph as a digest** — length and 64-bit
  FNV-1a — rather than verbatim, since the key is rebuilt for every plugin on every apply, the
  `tracks` path included. A pair sharing a key is compared in full, so a collision is a replace and
  never an unheard edit (`diff_faust_source_edit_is_replace`).
- **A `PluginParamChanged` carries the plugin's id**, not a copy of its whole `PluginDoc` — a drag
  sends one change per parameter.
- **The editor autosave's completeness check reuses one probe instance per plugin** instead of
  loading a fresh one every five seconds (`docs/pluginEditors.md`).
- **The audio sender asks the session registry for stale sequence counters once a second**, not on
  every 5 ms tick.

## Smaller hazards, and what closes each

- **A session whose only state is "record enabled"** is reaped like an empty one: with no Edit there
  is nothing to record into, and a client naming a stray id would otherwise pin it, 20 Hz frames and
  all, for the life of the engine. Turning record OFF never creates a session.
- **The input tuner watches at most `kMaxChannels`** — the numbers come off the wire, and each costs
  a ring.
- **A plugin hung inside `processBlock` ends the process instead of the message thread**: the device
  watchdog no longer reopens over a callback that is still inside, which would block on the lock it
  holds; past ten seconds the engine exits for the supervisor to restart it (`docs/audioDevice.md`).
- **A plugin whose own state goes non-finite recovers by itself**: Faust and a jsdsp graph clear
  their state on the next block, an amp model is reloaded off the audio thread (`docs/namPlugin.md`).
- **No file header sizes an allocation unchecked**: a cabinet IR past ten seconds, a Faust soundfile
  past ten minutes or eight channels, a record past six hours, are each refused before a buffer or a
  cache file is sized from them.
- **`--decode` refuses a header it cannot trust** — no channel or more than 32, a rate past
  768 kHz, longer than twelve hours — before a byte of audio is written.
- **A client message is capped at 64 MiB** by a fetch-time patch (`engine/patches/ixwebsocket.cmake`):
  IXWebSocket buffers a whole frame before anything reads it and its own limit is 2^63 bytes, so one
  message could exhaust memory. A frame past the cap closes that connection.
- **A plugin, model or instrument that crashes the engine as it loads is refused at its second
  crash**, by a marker written for the length of each load (`docs/crashes.md`). AIDA-X and Proteus
  files are checked first, every tensor against the shape the header declares, since RTNeural's
  loaders index what the header promises; a `.nam` is not, its loader being NAM's own, so the
  marker is what answers a truncated one.
- **The waveform tap's reset is a flag** the audio thread consumes, and a lapped drain stops short of
  the slots the writer may be filling.
- **The rate bridge** reads a plain static zero buffer rather than a `thread_local` (whose first touch
  can allocate on the audio thread), and a generator that produces nothing stops at one render.
- **Clouds and Warps** clamp to 16 bits as a float, a NaN made silence first: `lround` of either is
  undefined.
- **A platter's old record and a dropped session** are freed after their lock, not inside it.
- **The broadcast tap re-checks for a lap after copying**, as the recorder does, and sends torn frames
  as silence; both taps keep a 4096-frame margin, above Android's largest block.
- **The orphan plugins and windows are leaked with the engine they belong to**: destroyed at exit,
  after JUCE, either is a crash.
- **The pattern worker is waited for, never killed**: a thread killed inside its lock leaves it
  locked for good, and its work is bounded — a 250 ms script deadline, capped sample decodes.
- **The mixer and the platter ramp their gain** across a block rather than stepping it, and Faust and
  the eurorack modules size their buffers for the largest block a device delivers, rather than
  dropping a bigger one whole.
- **A graph's biquad and delay take a finite value or a fallback**: `jlimit` lets a NaN through, and a
  NaN reaching a filter or an index never leaves.
- **`serve()` installs a `set_terminate`** that logs what was thrown before the process aborts.

## The turntable harnesses measure at the rate they wrote

`keylock.ts`, `turntable.ts`, `turntable-loop.ts` and `turntable-latency.ts` count samples at the rate
their record was written at, and the stream arrives at the DEVICE's: read raw on a 44.1 kHz
interface, every pitch is 48/44.1 high, every period 9.5 % short, and two of them fail on any binary.
`platterBench.ts`'s `onBroadcast` resamples each frame to the harness's rate from the rate in its own
header, and the four read true — 1000 Hz for 1000, and every loop check passing. Their records are
stereo 16-bit, the format a deck maps.

## A platter's record is never held in private memory

`RecordSource.h`: a WAV of one or two channels — 16/24-bit integer or 32-bit float — is mapped where
it lies, and anything else is decoded once into a WAV in the record cache and mapped from there. The
deck reads a sample by its width and channel count; an in-memory decode is left only for a cache that
cannot be written. Every format renders as it did, within the 16-bit rounding the old decode applied
(`docs/turntable.md`).

## Left as lots

1. **A rack's samples are held whole in RAM** by Tracktion's sampler, decoded once per edit that
   needs it (above). They are one-shots — the rack caps at 64 sounds, and a slice rack's excerpts
   partition one file — so the sum is bounded by what the rack plays, and replacing the sampler to
   stream them would buy little memory for a whole instrument's worth of risk.

Open from the stability audit of 2026-10-11, each verified in the code and none yet fixed:

- **A Faust compile that never returns** hangs the message thread: libfaust's timeout does nothing in
  a library build. A crash while loading is answered (`docs/crashes.md`); a hang is not.
- **Parameter lists and orphan windows load plugin binaries in the engine**, one thread per request
  and no cap, including a plugin whose scan failed, from a path the client names.
- **JUCE's own fallback when an interface is unplugged goes unobserved**: armed tracks record
  silence and a recorder take continues at the old rate.
- **A failed apply leaves `current` describing the old document** over a half-built Edit.
- **A pattern note past 128 sounding at once gets no note-off.**
- **`io-levels` with thousands of channel sets, and `set-input-stereo` with a huge channel**, each
  cost the message thread or memory in proportion to one message.
- **A platter mapped from removable media** faults on the audio thread when the media goes.

## What a change here should be verified with

The build is fast and the suites are seconds; there is no excuse for a plan instead of a change.

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --target studio_engine_tests studio_session_tests \
      studio_midigraph_tests studio_dspgraph_tests --config RelWithDebInfo
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R studio_ --output-on-failure
./build/windows-msvc/RelWithDebInfo/st0-engine.exe --list-audio-devices
```

Four suites, and each must be **named** to be built — the presets pin `targets: ["st0-engine"]`.

What none of that says anything about: the `[applyFull]` line on a real project, and whether a
`play` issued the instant it appears is served immediately. That is the measurement this page
exists for, and it needs a browser.
