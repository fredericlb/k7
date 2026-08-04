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

## Audio devices

One physical interface is usually offered by SEVERAL backends (ASIO, Windows Audio,
DirectSound) under the same name, and they are **not** interchangeable — the ASIO one is the
low-latency path. So a device is identified by name **and** type, and the list reports each
`(name, type)` pair rather than each name. `setAudioDevice()` with an empty `type` means
"any backend offering that name", which for a device exposed by several is arbitrary; the
brain always passes it.

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
| `normalizeClips` | see [cliModes.md](cliModes.md) |

The param dumps are l8's text alternative to an opaque `.vstpreset`: the payload is
`{ "params": {paramID: value}, "complete": bool }`, where `complete` means the params fully
reproduce the plugin state and the preset can be dropped. The translator calls them to
store chain params on import.
