# EngineHost

`EngineHost` owns the Tracktion Engine and projects a `ProjectDoc` onto a live `Edit`. It
is the **only** layer that includes Tracktion or JUCE headers, and its own header keeps
them out of its interface (forward declarations only) so the WebSocket server compiles
against it without seeing JUCE at all.

`post()` / `onState()` / `run()` are what let a frontend live in another process or
language: all JUCE threading stays behind that API. Almost everything else here is
**message-thread only** — call it via `post()`.

## Applying a document

- `openAudioDevice()` opens the default stereo output. It is split out of the constructor
  so the server can bind its WebSocket port FIRST — answering whoami and probes
  immediately — and only then pay the device-open cost, which can be seconds on a busy or
  Bluetooth interface. Playback is silent until it runs.
- `applyFull()` builds a fresh Edit from the document and keeps a copy as the "current"
  state for later diffing. `baseDir` resolves clip and plugin paths (empty when they are
  already absolute).
- `apply(target)` moves the engine to `target` by the smallest set of changes: it diffs
  internally, applies incrementally — falling back to a full rebuild when a change requires
  it, such as a sample-rate change — updates the baseline, and returns the changeset for
  logging. Because `ProjectDoc` carries stable ids, the diff can say "track 'drums' gain
  changed" instead of tearing the graph down.
- `reset()` forgets the project entirely: close plugin editors, drop every plugin and its
  preset state, destroy the Edit, empty the diff baseline. The engine stays alive with its
  audio device and plugin scan cache, and the next apply diffs against nothing — so no
  plugin or state survives. Call it when switching projects, where diffing against the old
  song is meaningless.

`resetProjectState()` drops everything derived from the current project — editors, plugin
refs, preset-save state, level meters — in the order that keeps editors from outliving the
plugins they point at. It is shared by `applyFull()` (which then rebuilds) and `reset()`
(which does not), and leaves the Edit alone either way.

It keeps two things on purpose. The broadcast **wish** (`broadcastWanted`) and the ring survive,
so `buildLevelMeters` puts a fresh tap on the new edit — without that, saving a file silences
every listener, which is not a fault anyone would trace back to a save. And the parameter
**watches** survive, because a client's interest in an id outlives the plugin behind it; only
their baselines are cleared, since diffing new values against the torn-down instance's would
hide any parameter that came back different.

### The audio device is opened with its INPUTS

`openAudioDevice()` calls `initialise(512, 2)` — 512 being Tracktion's own default, meaning "as
many channels as the device has". The input half is not decoration. With **zero** input channels
open the audio callback delivers no input samples at all, so no `WaveInputDevice` ever sees one:
every input then meters exactly −100 for ever while its device still reports itself enabled,
which is what an interface with nothing plugged in looks like. Nothing anywhere reports a fault.
Switching device by hand HIDES it, because `setAudioDevice()` sets `useDefaultInputChannels` — so
recording works right up until an engine opens the device itself.

The buffer this engine asks for is applied **after** `initialise`, by `applyPreferredBufferSize`:
there is no device to ask before it.

### What `applyFull` orders, and why

Every graph-invalidating call sits above `ensureContextAllocated()`. `insertPlugin` reaches
`Edit::restartPlayback()`, which rebuilds the entire graph 1 ms later on this same thread — so
allocating the context first and *then* adding meters and a click built it twice: once inside
`applyFull`, and once after it had already returned and answered `busy:false`. The second build
landed on whichever message-loop turn came next, in practice the one carrying the user's first
`play`. That was the freeze; see [audit-stabilite.md](audit-stabilite.md). The phase timings are
printed once per apply for the same reason, so a slow first play is diagnosable from the log.

### A retimed clip is RE-INSERTED, and a stub in that switch is not free

`ClipMoved` covers any change to a clip's start, length, source, offset, source window,
loop, warp **or notes** — `clipMoved()` in ProjectDiff compares all of them together, because
they are applied in one place: at INSERT time, by `clipPositionFor`, `applyClipLoop`,
`applyClipWarp` and the MIDI fill, and nowhere else.

The comment above that function carries the rule the whole thing rests on: *a field missing
here is a field you can edit while the engine is up and hear nothing change*. NOTES are the
trap of the set — a clip's identity is its id, which a note edit does not touch, so leave them
out of the comparison and `diff` reports no change at all: the entire note vocabulary
(`sequence note new`, `remove`, `velocity`, `move`) reaches the engine and alters nothing
audible. It is a `std::vector<NoteDoc>`, so `NoteDoc` carries the field-by-field `operator==`
this comparison needs. The audible check on a real song: remove one snare and the master's
energy over that beat drops by a quarter — three identical readings mean the field is not in
the comparison. So the incremental case removes the clip and inserts it again rather than
calling `setStart`/`setLength`, which would move it and silently drop everything else it
carries.

An empty stub in that switch is the shape of failure worth remembering: the diff still runs,
so the changeset still says `~ clip on deckA moved` and the log reads as a success while
nothing in the edit moves. `needsFullRebuild()` does not list `ClipMoved`, so there is no
rebuild to cover for it either.

Such a stub also hides from anything that renders. An **offline render stretches the same
document correctly** whatever this path does — a render calls `populateEdit`, which BUILDS
rather than diffs, so it never touches it. Any check that renders passes while live playback
does nothing; the two paths have to be tested apart.

The cost is a clip re-insert per change, so a control that retimes a clip — a tempo fader is
a clip warp — commits on release rather than per pixel.

### Adding a plugin does not rebuild the song

`needsFullRebuild()` does not list `PluginAdded`, and that omission is deliberate: listing it
makes putting one module in a chain throw the whole Edit away and build another from the
document — every plugin instantiated again, the 31 that have not changed along with the 1 that
has. On a real 32-plugin song:

| | |
|---|---|
| full rebuild, cold | **4397 ms** (`populate` 4338) |
| full rebuild, warm | 694–1161 ms |
| **incremental insert** | **6 ms** |

The transport is dead for the whole of a rebuild, because this is the thread that also reads
it. That is the whole of "why does adding a module freeze the engine".

`apply()`'s `PluginAdded` case creates the one plugin with the same `addPlugin()` the build
path uses, and inserts it into the live track. The position is read off the LIVE plugin
list, not from the document's index, and that distinction is the whole of the correctness:
a waveform tap is also a plugin in that list — `watchWaveform` inserts one beside the module
it watches — so a document index lands in the wrong place the moment a waveform widget is
open. It finds the doc plugin that PRECEDES the new one and inserts after it.

Everything it cannot place exactly where a rebuild would, it hands to a rebuild:

- the plugin declares a **sidechain** (its second input is wired by a pass that runs after
  every track exists, against itemIDs this path has no equivalent for);
- the same diff **adds or removes a track** (`trackById` resolves by index, so the document
  and the Edit are briefly out of step and the plugin would land on the wrong lane);
- the track carries a **waveform tap** (ambiguous position, as above);
- the preceding plugin is not in the live list (nothing to anchor to).

`PluginRemoved` is incremental for the same reason and one of its own: a rebuild replaces the
Edit, and therefore the transport with it, so unlinking a module would stop the song. Taking
the plugin out of the live chain leaves what is rolling untouched. A module SWAP surfaces as
remove + add, removals first, and so costs no rebuild either.

**What is verified, and what is not.** The policy is unit-tested (`ProjectDiff_test.cpp`),
and the timings above are measured against the real project, inserting both at the end of a
chain and in the middle. The resulting chain ORDER is not: `pluginInstanceInfos` iterates a
map keyed by id, so no engine surface reports the order a track's plugins actually sit in,
and nothing renders it. It is right by construction — `populateEdit` inserts doc plugins at
increasing indices, so "after the previous one" is the same position — and by the fallbacks
above. Ordering is audible, so it is worth listening to once after touching this.

## The master chain, and the order of what watches it

`buildLevelMeters` appends a `LevelMeterPlugin` per audio track, then assembles the master list.
Three things go on it, in this order, and the order is the graph's own — `MIX -> [chain] -> OUT`,
then the engine observing what leaves.

1. **The song's output level.** The OUT node's `Volume`, and so the last thing in the song. It is
   **FOUND, not made**: `populateEdit` put it there, right behind the master chain, because the
   offline render runs that and nothing of `EngineHost.cpp` (see `populateMasterChain`). It is held
   in the session so `MasterVolumeChanged` has something to set without walking the list again, and
   `applyFull` sets it from `doc` — because that is where `doc` is the truth. See
   `packages/song/docs/masterVolume.md`.
2. **The master level meter**, which MUST sit after that gain: Fix writes this very param, and a
   Fix the meter could not see would leave the clip light lit and offer itself again on the next
   pass, taking another 6 dB each time. An output DEVICE carries no measurer in Tracktion — only
   inputs do — so this plugin is the only place the outgoing level can be read at all. It carries
   **two** clients: one for `io-levels`, one for the state frame, so neither reader clears the
   other's peak (`EngineHostImpl.h`'s `masterStateClient`).
3. **The broadcast tap**, last. The two costs of following the graph rather than preceding it are
   stated rather than hidden: raising the output raises the meter's bar, and a listener on the
   broadcast hears the level this room is set to.

### What holding them costs — release before the edit, not after

Everything above is **held in the session**, which buys the lookups the list explains. The price
is a rule with no exceptions: a `Plugin::Ptr` the session keeps must be let go **before** the edit
it came from is replaced. `applyFull` assigns a new `Edit` over the old `unique_ptr`, and that is
where the old one dies — so a reference outliving that line is a reference into freed memory, and
the moment it is finally dropped is a destructor running against an edit that is gone.

That is not theoretical. `MasterGainPlugin::~MasterGainPlugin` opens with
`notifyListenersOfDeletion()`, which walks into the edit's `ParameterChangeHandler` and takes its
mutex; against a destroyed edit it faults on the lock itself:

```
[crash] exception 0xc0000005
  #0 Mtx_lock
  #1 ParameterChangeHandler::getPendingParam
  #2 AutomatableEditItem::deleteAutomatableParameters
  #3 Selectable::notifyListenersOfDeletion
  #4 studio::MasterGainPlugin::~MasterGainPlugin
  #6 studio::EngineHost::buildLevelMeters
  #7 applyFull
```

`teardownProjectState` states the rule in its own first comment and observes it for plugin
windows, `pluginsById`, the waveform taps and the broadcast plugin; `detachLevelMeters` observes
it for the meters and their clients. **`masterGain` was the one that did not**: found rather than
made, it read as the edit's business rather than the session's, and nothing ever nulled it. The
crash therefore waited for the reassignment on the next rebuild to drop the last reference, which
is why it reads as a fault inside `buildLevelMeters` rather than where the edit died.

It survived a long time because freed memory usually still looks like an edit. What broke the
spell was a project growing eight stem tracks at once — more plugins, different allocation, and
the mutex landed on something that had been reused. A lifetime bug is not made real by the shape
of the project, only visible by it.

### The overload flag is deduced, and it is exact

`masterState()` reports whether the master went over full scale since the last frame, and it
deduces that from the peak rather than asking for a flag. That is exact, because the peak itself
latches: `updateAudioLevel` keeps the running MAXIMUM since the last read, so one frame's dB is
the loudest sample of the whole 50 ms window and not a 20 Hz sample of a waveform. A clip is one
sample over full scale; if there was one, it IS this number. The threshold is 0 dB, Tracktion's
own — `processBuffer` overloads a channel above 0.999. Both channels are read unconditionally,
because reading CLEARS: skipping one would carry its peak into the next frame and report a clip a
window late.

It is deliberately **not** `Client::getAndClearOverload()`, which is named for a question it does
not answer: that returns `clearOverload`, the flag a meter WIDGET is handed to be told "you were
asked to reset" — true once at construction, then false for good. Tracktion keeps the real
per-channel `overload[]` private with no getter, which is why the level is the way in.

## Sessions: who is driving, and what an idle one costs

A **driver** is a socket belonging to a surface somebody is looking at, which declares itself on
hello. The file service is not one: it keeps a socket per session for as long as the machine is
up, so counting it would mean no project ever looks abandoned.

`releaseAbandonedProjects(graceMs)` frees the Edit, its plugins and its meters of every project
whose last driver left more than `graceMs` ago — and the grace is what makes doing it safe at all.
A closing tab, a reload, a dropped connection and a laptop lid are the same event from here, and
only one of them means "I am done", so waiting is the only way to tell them apart. 45 seconds is
long enough to survive a reload, a redraw and a flaky minute of Wi-Fi; short enough that closing a
tab and walking to the machine finds it free. A refcount with no grace at all takes a loaded
project away on every tab reload. It calls `reset()` and not `drop()`: the SESSION survives, so a
tab that comes back re-sends its document into the same slot, and anything still keyed on the id —
a watch, a subscription — keeps meaning what it meant. See [sessions.md](sessions.md).

The sweeps ride the state timer rather than adding one. Abandoned projects are swept every five
seconds — a hundredth of the grace, so what a person sees is the grace and not the sweep; a 45 s
grace swept once a minute would take up to a minute and three quarters, and the whole point is
that closing a tab frees the machine promptly. Empty sessions are reaped once a minute after ten
minutes untouched, which can afford to be lazy: dropping an EMPTY session is invisible, so the
only cost of waiting is a map entry.

### The idle divisor

An idle session sends one frame in five, which at the 50 ms tick is 4 Hz. Everything the frame
reads is cheap; what costs is what comes after — serialising it, pushing it down every socket, and
then a browser parsing it and running every subscriber's selector over it, twenty times a second,
to conclude that a stopped transport over silent tracks still says nothing. Five ticks is slow
enough to disappear from a profile and quick enough that a change made from another tab shows up
before anyone reaches for the mouse.

"Idle" tests the levels as well as the transport, because an **audition** sounds without the
transport rolling and a monitored input moves a meter while it does; `sessionWatched()` is in the
test for the same reason, a waveform tap and a followed plugin being the two things that carry new
numbers while nothing sounds. The counter counts up to the divisor and back to zero rather than
taking a modulo of a counter that only grows: this runs for as long as the engine does. When a
frame is skipped nothing is drained or pumped either — an idle session has no tap and no watch.

## Session state lives here, and only here

Arming, the global record enable and the loop region are **not** song state: they live in
the engine, die with the process, and never reach a file. The engine is the only long-lived
thing the one-shot CLI and the restartable web backend share, which is what makes it the
only place they can live. Tracktion already stores the arm flag per input destination on
the Edit's ValueTree, which we never save — so `armedTracks()` is a read of that, not a
second copy.

`setTrackArmed()` with `armed` unset **toggles**, and resolves it here against the flag
itself rather than having the caller read the state and write back the opposite — which
would race the 20-per-second broadcast the caller read it from. A track with no live input
cannot be armed: there would be nothing to capture, so it refuses rather than record
silence.

### The count-in is engine-global

`setCountInMode` LOOKS like an `Edit` property and is not one: Tracktion implements it as
`engine.getPropertyStorage().setProperty(SettingID::countInMode, …)` — process-global, and flushed
to the `%APPDATA%/Studio/Settings.xml` this engine otherwise treats as inert. Calling it on every
`play()` therefore rewrote that file every time anyone pressed play, which is why `play()` guards
on `countInApplied`. Being engine-global also means two sessions share ONE count-in; that is
survivable exactly because each play asserts the mode it needs, and it is why the call must stay
inside the transport branches rather than being hoisted out of them. Tracktion's enum caps at two
bars, which is enough for the usual count, and during one it rolls those bars before capture AND
sets a click range, so the count is audible even with the metronome otherwise off. A plain `play()`
clears it, so an earlier record's count-in cannot linger onto ordinary playback.

## Plugin parameters: three different questions

| call | question |
|---|---|
| `pluginParams(id)` | *what is it holding?* Every parameter with its current value, defaults included. |
| `pluginParamsWithMeta(id)` | the same, plus the range and default a control needs to draw itself. |
| the `plugin-params` broadcast / `--dump-params` | *what must be saved?* Only what differs from the default. |

`pluginParams` is also the only way to enumerate a loaded plugin's parameter names.

Ranges are in the parameter's **own** units: an external plugin normalises to 0..1, a
built-in does not (4OSC's filter is 0..135, its level -100..0 dB), so a widget must take the
range as given rather than assume either convention. A discrete parameter's states carry
the value that selects each label rather than deriving it from the index.

`setPluginParam()` applies to the **live plugin only** — the caller owns persistence, so a
value set this way is lost on the next full rebuild unless it also lands in the project.
This is the live-drag path: called at interactive rates, and so it does not log.

### Watching

`watchPluginParams(id, on)` is the one direction nothing else covers: a knob turned in the
plugin's OWN native window reaching a remote UI. `setPluginParam` is the remote UI writing
in, and `onPluginParams` only fires once the editor closes.

It is per-plugin and off by default because it costs a full parameter read per tick — a
client asks for the handful it is showing. An id with no live plugin is accepted and simply
never reports: a watch is a standing interest, so it must survive the rebuild that briefly
removes the plugin.

Reporting happens from the state timer, so a watch is bounded by the same cadence as the
meters. A native editor's knob generates far more changes than a UI can draw, and
*sampling* rather than listening to each one is what keeps a fast drag from flooding the
socket. The cost is that a change reverted within one tick is never seen, which for a
display is the right trade.

The live sink is deliberately **not** `onPluginParams`, even though the subject matches:
that one means "this is the state to persist" and the brain writes it to the module's file,
so routing a mid-drag feed there would rewrite the project tens of times a second. It sends
values, not deltas — the receiver keeps a whole-plugin map, and a partial update would need
merge rules on every client for no saving worth the divergence.

## Waveform taps, and the broadcast's two threads

`enableWaveformTap` finds the plugin **by id** and derives the track from the plugin, rather than
trusting a track index from the client and matching on the plugin's display name. Both halves of
that were wrong. The graph has no track index to send — a chain can be a bus with no track of its
own — and the name compared was the PLUGIN's, "Neural Amp Modeler", against the MODULE's,
"neural-amp-modeler", so the target was never found and the tap silently went to the end of the
chain, metering the track output instead of the module. `pluginsById` is keyed by exactly the id
the client sends. `"input"` inserts before the plugin, `"output"` after it, and the map owns a
reference keeping the tap alive, as does the track's `pluginList`.

`drainAllWaveformTaps` drains every tap at once, deliberately: there is no per-module drain, so no
second reader can empty a tap the state timer is about to read.

**One envelope point per FRAME, not per sample.** The drain is a single chronological array and
`WaveformWidget` draws it as one line, so the two channels have to fold into the same bucket —
`WaveformTap::pushFrame` takes the min and the max across the pair. Pushing the whole left block
and then the whole right one would draw every block **twice** at twice the documented rate, and
since a 256-sample bucket does not divide an arbitrary block, the bucket straddling the L→R seam
would mix two channels into one point — hidden by a correlated mix, a flicker on anything
hard-panned. `pushSample` is `pushFrame(s, s)`, for the mono case.

The broadcast section of the header is the one place that is **not** uniformly message-thread.
`enableBroadcast` and the tap's insertion are; `drainBroadcast` and `skipBroadcastToLive` belong
to the sender thread and must never be wrapped in `post()`, which would put a second consumer on a
single-producer/single-consumer ring. `drainBroadcast` never posts, but it does take the session
registry's lock for the length of a memcpy, because the map it finds the ring in is written by the
message thread; no session yet means no frames, which the caller already treats as "nothing to
send". The tap is pointed at its ring **before** it joins the master list: once inserted, an audio
callback can reach it at any moment, and a plugin with no ring yet would drop those blocks. See
[broadcast.md](broadcast.md).

## Audio devices

One physical interface is usually offered by SEVERAL backends (ASIO, Windows Audio,
DirectSound) under the same name, and they are **not** interchangeable — the ASIO one is the
low-latency path. So a device is identified by name **and** type, and the list reports each
`(name, type)` pair rather than each name. `setAudioDevice()` with an empty `type` means
"any backend offering that name", which for a device exposed by several is arbitrary; the
brain always passes it.

### What the open device costs, and who may ask

`audioTiming()` reports the buffer the device works in and the rate it runs at. A browser turns
the pair into milliseconds — `2 × buffer / rate`, a block in and a block out — and adds its
measured round trip, which is what decides an engine's quality band. Both zero means "not
measured", never "instant". It reads two atomics and nothing else, so it is safe from ANY thread,
and that is the point: `whoami` answers on the socket's own thread, keeping the probe out of the
message queue. `publishAudioTiming()` is the message-thread half that refreshes them — it
dereferences the live device, which is exactly what `audioTiming()` must not do, so call it after
anything that opens, closes or re-buffers one.

### Metering the interface rather than the song

`channelLevelsDb` asks about the INTERFACE: it needs no track, no arming and no edit, which is
what lets the I/O panel meter an input nothing is recording yet. Each answer carries `found` as
well as a peak, because without it the two failures are one number — a channel nothing is plugged
into and a channel that does not exist both read −100, and the panel could only draw the same dead
bar for each. It also ENABLES each device it finds, a disabled one producing no signal to measure,
so it is a poll with a side effect and only worth making while a surface is actually looking.
`channelPitches` is the tuner's counterpart: one fundamental per set, read from the set's first
channel since a stereo pair carries one instrument, and it starts the input tap on first call so
nothing is analysed unwatched.

`inputDevices()` reports how this rig actually groups its inputs — one entry per wave input device
with the 1-based interface channels it carries. An interface pairing its inputs into stereo
devices is the normal case and is invisible from everywhere else, which is precisely how a channel
that "exists" can meter nothing.

`setInputStereo(channel, stereo)` pairs or splits, and the partner is **not** a choice: Tracktion
pairs even/odd hardware channels only, so 1 goes with 2 and 3 with 4, and channel 2 can never be
paired with channel 3 (`describeStandardDevices` walks the list two at a time). Passing either
half of a pair names that pair. Tracktion persists the grouping itself, per audio device TYPE, and
rebuilds the device list — so that call is the whole of it, and `inputDevices` reads the result
back. Pairing **destroys** the two mono devices: their names merge, and a device is identified by
its name, so anything still asking for one of those channels alone — a module with `channel: [2]`
— then matches nothing and reads as silence, which is `findWaveInput`'s own rule met from the
other side.

`audioDeviceName()` returning "" means the engine can neither make a sound nor **keep
time**: with no output there is no audio callback to advance the playhead, so the transport
reports playing while nothing moves. Callers say so out loud, because nothing else will.

## Recording hand-off

The `onRecorded` sink fires once a take has finished and its file is closed and renamed,
carrying the track id, the absolute `.wav` path, and the position in **seconds**. The
engine stops there: it hands over a file and a position, and the brain turns that into a
clip declaration and a placement. Seconds rather than beats, because the tempo map is the
brain's to read and the engine would only be converting back.

`prepareTakes()` names the take each armed track is about to record and points the input
devices at the record directory, called from `play()` the moment before the transport rolls
so the timestamp is the take's start.

A take records OVER the lane's own material, so the armed track is muted once the punch-in
arrives — not at the top of the roll: the count-in plays the already-recorded clips, then
they go silent under the pass while the input is captured. `RecordListener::recordingStarted`
computes the count-in duration from the punch-in `SyncPoint` and mutes at the end of it, so
the mute is session state applied at capture and restored by `stop()` through `applySoloMute`;
it never reaches a file — the brain's writer places only the new clip and does no overlap
arithmetic (`packages/take-render/docs/rendering.md`).

**Except a TAKE of an event** (`ProjectDoc::recordMute` false): the brain has already cut the punch
out of the lane it sent, so the old performance is heard around the punch and the track is NOT
muted — muting it would silence what the punch was chosen to keep (`packages/song/docs/takes.md`).

Track inputs are pointed at their live interface input by a step that needs an allocated
playback context — the input instances live on it — so it runs **after**
`ensureContextAllocated()`, never inside `populateEdit()`.

## The command-line entry points

These are static and wire up from `main()`:

| entry | mode |
|---|---|
| `loadPluginCache` | read the cached plugin list, no scanning — what the `list` commands use |
| `scanInstalledPlugins` | enumerate installed plugins, load only the new or changed ones (each in a child process), update the cache; `forceRescan` re-scans everything |
| `runPluginScanChild` | `--scan-plugin <fmt> <id>`: load ONE plugin in isolation and print its descriptions as sentinel-fenced JSON, so a crashy plugin only kills this child |
| `runPluginScanCli` | `scan [--force]` |
| `runListAudioDevicesCli` | `--list-audio-devices`: builds only a JUCE device manager, opening no device and starting no engine, so it works with nothing running |
| `dumpPluginParams` | `--dump-params <type>` — a built-in, always complete |
| `dumpPluginParamsExternal` | `--dump-params-ext <format> <identifier> <statefile>` — an external restored from its `.vstpreset`, complete iff it round-trips |
| `renderDocument` | `--render <doc.json\|-> --out <dir> [--stems]`: offline bounce with no audio device, so MIDI and instrument tracks are rendered (unlike an ffmpeg mixdown) |
| `writeWaveformCache` | `--waveform <audiofile>` — see [cliModes.md](cliModes.md) |
| `printFilePeak` | `--peak <audiofile>` — the measuring half of a cold module, see [cliModes.md](cliModes.md) |

The param dumps are st0's text alternative to an opaque `.vstpreset`: the payload is
`{ "params": {paramID: value}, "complete": bool }`, where `complete` means the params fully
reproduce the plugin state and the preset can be dropped. The translator calls them to
store chain params on import.

`dumpBuiltinParams` is its own mode rather than a case of `--dump-params`, and the two answer
different questions: that one emits the NON-DEFAULT subset, the "preset" of an instance somebody
configured, so on a freshly created plugin it prints `{}` however many parameters the thing has.
This one asks what a plugin TYPE HAS, which is what the module builder needs answered before any
instance exists. See [builtinParams.md](builtinParams.md).

### What the scan cache carries

`PluginInfo` is the cached entry. `descXml` is the full `juce::PluginDescription` as XML — empty
in older caches — so the engine can instantiate without re-introspecting the binary. `category` is
what KIND of effect it is, lower case, `''` when unknown, and it has three sources in descending
trustworthiness: an AirWindows plugin's closed enum, a built-in's hand-assigned kind, and an
external's freely-written category (`"Fx|Delay"`, but also `"OnlyARA"`). Good enough to file a
module under; not a taxonomy.

### Asking an EXTERNAL plugin what it has

`pluginParamsOf(format, identifier)` instantiates the plugin and asks. The built-ins are answered
from a table generated once and committed; an installed plugin cannot be, because which ones exist
is a fact about this machine, and the scan cache carries a plugin's name, format and category but
no parameters — the plugin's constructor is where they are registered. It runs on an OFFLINE
engine of its own, since the live one holds the audio device, kept for the run and shared by every
query.

`nullopt` and an EMPTY vector are different answers, and telling them apart is worth a whole
return type: `nullopt` is "this machine could not find, create OR LOAD the plugin", an empty vector
is "it loaded and genuinely publishes none". The third word in that list was missing for a while
and it mattered — `createNewPlugin` returns a `Plugin` whether or not an instance was made, so
twenty-seven plugins that refuse to load on this machine came back as an empty parameter list and
were reported as plugins that publish nothing. They are not: it is a licence or an installation,
and only `nullopt` sends anyone to look at it.

### The orphan window, and the one thing that comes out of it

`prepareNativePluginUI` / `showNativePluginUIOf` open the same plugin's OWN window on an instance
that belongs to no project. The pair exists because a module is authored against a plugin the open
project need not load — the hole `pluginParamsOf` fills — and a list of parameter names is only
half of what somebody staring at an unfamiliar synth wants.

ORPHAN, and every consequence of that word is deliberate: the instance sits on the offline engine's
edit, on no track, wired to nothing, and NOTHING IT IS TOLD IS SAVED. Turning a knob in that window
changes this instance and no module, no project and no file. It is a place to look at a plugin, not
a place to set one — which is why it needs no session and cannot disturb what is playing. External
plugins only; a built-in wraps no `AudioProcessor` and draws no window.

It is SPLIT IN TWO because the halves want different threads. `prepareNativePluginUI` loads the
binary and is SECONDS — call it off the message thread, exactly as the param query does. Only then
call `showNativePluginUIOf`, which is the JUCE part: message thread, and fast, because the instance
is already there. Doing both on the message thread would stall the transport of every session on
this engine for as long as the plugin takes to load. Both answer whether they worked, and the
SECOND one's answer is the one a caller must relay: `prepareNativePluginUI` is false for the same
three failures `pluginParamsOf` answers `nullopt` for, while `showNativePluginUIOf` is false when
there is no loaded instance to draw, when the plugin has no editor, or when the editor would not
build. It never loads one itself, because a plugin construction can hang and it runs on the message
thread.

`snapshotOrphanPluginTo` is the other end of that window: the one act that takes something out of
it — a sound dialled in by hand, captured under a name — and it is a separate, explicit call for
exactly that reason. Opening a plugin must stay free of consequence; keeping what you found there
must be something you asked for. It writes ONLY an instance that is already loaded: no orphan means
false, and never a freshly-created one, since a snapshot of a plugin nobody has opened is the
factory default wearing the name of a sound somebody thought they had made. `outFile` is ABSOLUTE
and its parent is created — the caller is the file service, on this same machine, the only side
that knows where a module's folder is and the only side that can be trusted to have checked the
name. The format is a Steinberg container via `saveVstPreset`, which is what `loadVstPreset` reads
back, so a base written here is loadable by every path that already takes one. Message thread: the
plugin may be on screen with its editor open, and this reads its state.
