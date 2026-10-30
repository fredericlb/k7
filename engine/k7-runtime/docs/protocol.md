# The engine's WebSocket protocol (`server/Serve.cpp`)

`k7-runtime` is a headless audio server: a thin WebSocket bridge over
`studio::engine`, speaking JSON. The engine does not parse files — the Node brain
interprets the song, resolves clip paths to absolute, and sends the project as JSON.

`Serve.cpp` includes **no** JUCE or Tracktion headers: all engine threading sits behind
`EngineHost`'s `post()` / `onState()` / `run()` API.

## A LAN peer is paired before anything else

Every message passes one gate first (`server/ServePairing.cpp`): a loopback peer — the machine, or the
server's relay — goes through; a LAN peer is answered there until it is paired, and only `whoami`,
`pair-request` and `pair` get anything but an `unpaired` error. Machine-wide replies skip untrusted
sockets. The flow and its choices are [pairing.md](pairing.md).

## Every message carries a session

`{ "session": "k7:fred", … }` on any message names **which project on this engine** it is
about. One process hosts several (`docs/multiEdit.md`), so without it the médiathèque's
module preview and a DJ deck would each replace whatever k7 has loaded.

The field is optional and absent means `""`, the default session — so a client that has
never heard of sessions still works.

**Every reply about one project carries it back**, and only these do not, because they are
the machine's rather than a project's: `plugins`, `plugin-scan`, `audio-devices`, `sessions`,
`edit-plugins` and `whoami`, and the pairing and plugin-type replies beside them. That is a closed set — it is `ENGINE_GLOBAL_REPLIES` in
`packages/engine-protocol/sessions.ts`, with `PER_SESSION_REPLIES` beside it, and
`sessions.test.ts` pins both. It matters that the set is closed: the client's filter passes a
frame with **no** session at all (so an older engine does not strike it deaf), which is safe
only for as long as this engine stamps everything else. In `Serve.cpp` the choice is a verb —
`broadcast` or `broadcastTo`.

A session is created by a client **driving** one — sending a project, subscribing to its audio,
enabling record — and never by asking about one: reads go through the non-inserting accessor, so
a supervisor that polls this engine does not conjure sessions by watching it. They are dropped
with `{"type":"drop-session"}`, and an EMPTY one is reaped after ten idle minutes. Each has its
own edit, plugins, meters, watch set, record enable and **broadcast tap**: an audio listener
hears the session it subscribed for, not the machine's master.

The engine's own half of this — the registry's threading model and the lifecycle rule — is
`docs/sessions.md`. Client rules, who picks the name, and why k7's two halves must agree on it
are in `packages/engine-protocol/docs/sessions.md`.

## A malformed message is ANSWERED, never thrown

The whole dispatch in `server/Serve.cpp` sits inside one `try`, and that is load-bearing rather than
tidy: **IXWebSocket contains no `catch` at all**, so an exception leaving the handler unwinds the
connection thread and leaves that socket alive-looking and permanently deaf — no reply, no close
frame, so nothing on the client ever triggers a reconnect. The measurement, and what it costs the
listener and driver maps, is in `docs/audit-stabilite.md`.

Two throws are reachable from any client, both out of `nlohmann`'s `value(key, default)`:
`type_error.306` when the message is not a JSON **object** (`[]`, `null`, `"hi"` all parse), and
`type_error.302` when a field carries the wrong type (`{"type":"transport","action":5}`). Neither is
worth hunting field by field, which is why the guard is one catch rather than a hundred checks. A
client gets `{"type":"error","message":"malformed message: …"}` and keeps its socket.

The handler is a **named** lambda, `onMessage`, for that reason alone: the registration wraps it.

## client → server

`project`, `tracks` and `set-plugin-param` may be skipped while still queued, when a newer one of the
same session makes them pointless; every other verb fences them, so order between verbs holds —
[supersede.md](supersede.md).

| message | meaning |
|---|---|
| `{ type: "project", doc: {…ProjectDoc…} }` | set or update the song |
| `{ type: "tracks", tracks: [{…TrackDoc…}] }` | replace just these tracks in the song already held — see below |
| `{ type: "flush" }` | forget the song entirely |
| `{ type: "transport", action: "play" \| "stop" \| "toggle" \| "rewind" }` | bare transport verbs |
| `{ type: "transport", action: "seek", position: 12.5 }` | seconds |
| `{ type: "transport", action: "loop", start: 4, end: 8, enabled: true }` | loop region, in seconds |
| `{ type: "preview", file: "/abs/kick.wav", start: 0, length: 0 }` | audition a sample; a `length` of 0 plays to the end of the file, at most 30 s ([engineHost.md](engineHost.md)) |
| `{ type: "note-preview", track: "melody", key: 60, vel: 1 }` | audition ONE note through that track's own chain — the piano roll's click. Transport-independent like `preview`, but not the same thing: `preview` loads a FILE into a hidden sampler and bypasses every chain, while this plays a note into the track the loaded song already names, so what you hear is the instrument you are writing for. The engine releases it after 100 ms, which is why there is no note-off on the wire: a release that has to arrive is a hanging voice whenever it does not |
| `{ type: "midi-live", track: "keys", data: [144, 60, 100] }` | a keyboard PLAYED into that track's own chain: one channel message (note on/off, pedal, bend, CC) injected as it arrives, on channel 1 whatever the keyboard sent on. Unlike `note-preview` the release DOES travel the wire, since a played note lasts as long as the key is held; the browser sends all-notes-off and sustain-up when the lane loses its arm, which is what keeps a lost note-off from hanging a voice for good. A socket that CLOSES with notes or the pedal down — a tablet off the Wi-Fi sends nothing more — has them released by the engine, which follows each socket's held notes per track (`server/HeldNotes.h`). Sysex and system bytes are dropped |
| `{ type: "watch-plugin-params", id: "chain:module", on: true }` | follow a plugin's values live |
| `{ type: "subscribe-waveform", id, side: "input"\|"output", trackIndex }` | tap a module's audio |
| `{ type: "unsubscribe-waveform", id, side }` | drop that tap |
| `{ type: "list-presets", module: "synth" }` | → a `presets` reply |
| `{ type: "set-preset", module: "synth", index: 3, path: "" }` | pick a preset |
| `{ type: "list-edit-plugins" }` | → an `edit-plugins` reply. Engine-global: it answers for EVERY session, each row naming its own, because a supervisor asking drives none of them |
| `{ type: "arm", track, armed }` | arm a track for recording → `armed`, or an `error` |
| `{ type: "record-enable", enabled: true }` | whether rolling this session records; the state frame's `recordEnabled` carries it |
| `{ type: "get-plugin-params", id }` / `{ type: "set-plugin-param", id, name, value }` | read / move one plugin's values |
| `{ type: "io-levels", channels: [[1,2]] }` | input meters + tuner, plus THIS session's master level |
| `{ type: "list-audio-devices" }` / `{ type: "set-audio-device", name, deviceType }` | the machine's interface. Engine-global — one device per process |
| `{ type: "rescan-plugins" }` | re-scan the installed catalogue: incrementally, or from nothing with `force: true` |
| `{ type: "plugin-scan" }` | where the plugin scan stands → a `plugin-scan` reply, to the asking socket alone ([plugins.md](plugins.md)) |
| `{ type: "whoami" }` | identity probe, answered to the asking socket alone; to an unpaired LAN peer, without the token and with `needsPairing`. `audioToBrowser: true` says nobody hears this machine's device, so a client plays the broadcast ([broadcast.md](broadcast.md)); `messageThreadMs` is how long the message thread has been silent, what the supervisor restarts a wedged engine on ([hangWatch.md](hangWatch.md)) |
| `{ type: "pair-request", name }` | a LAN device asks to be paired → `pair-pending` with the code it shows; later `paired` with its key, or `pair-denied`. See [pairing.md](pairing.md) |
| `{ type: "pair", key }` | first on a LAN socket: this device's key → `paired`, or an `unpaired` error |
| `{ type: "list-pair-requests" }` / `{ type: "list-paired-devices" }` | the machine's own clients only → `pair-requests` / `paired-devices`, both also pushed to them on every change |
| `{ type: "pair-approve", requestId }` / `{ type: "pair-deny", requestId }` / `{ type: "unpair-device", deviceId }` | the machine's own clients only; refused over the LAN with code `local-only` |
| `{ type: "instrument-status", refs: ["@instruments/nbo-wurt/wurly.sfz"] }` | → `{ type: "instrument-status", status: { ref: true/false } }`, to the asking socket alone: whether each sampled instrument a project names is on THIS machine. k7 draws the missing ones as errors on their nodes; the supervisor is what fetches them ([sfzPlugin.md](sfzPlugin.md)) |
| `{ type: "hello", role: "driver" }` | the same probe, **and** "a person is looking at this session" — the engine frees a project 45 s after its last driver goes. Omit `role` and nothing is counted, which is how the file service and every prober stay out of it. See [sessions.md](sessions.md). |
| `{ type: "list-sessions" }` | → a `sessions` reply. Engine-global: it is the one question whose answer is about the OTHER sessions |
| `{ type: "drop-session", session: "k7:fred" }` | forget a session outright — edit, plugins, meters and tap |
| `{ type: "show-native-plugin-ui", id: "chain:module" }` | open the plugin's own window |
| `{ type: "show-native-plugin-ui-of", format, id }` | the same window for a plugin in NO project — an ORPHAN instance on the offline engine, saved nowhere. `format`+`id` name a binary, as `list-plugin-params` does |
| `{ type: "snapshot-plugin-base", format, id, path }` | keep what that orphan is holding: its state written to `path` as a `.vstpreset`. Refuses when no window was opened — see `plugin-base-saved` |
| `{ type: "broadcast", on: true }` | send me the master audio (this connection only) |

### Two `ProjectDoc` fields that are not self-evident

**`masterVolume`** is the song's output level in dB on the master fader; 0 is unity, and unity is what a
doc that says nothing means. `EditBuilder` writes the value onto the fader on **every** build, because
Tracktion's own default is −3 dB: left alone, every mixdown quietly loses 3 dB.

The +6 ceiling is not a policy either. `decibelsToVolumeFaderPosition` is `exp((dB - 6) / 20)` clamped
to 1, so anything above +6 sets the same fader position. The brain's schema refuses a higher value
rather than letting it be clamped silently here.

**`masterPlugins`** is the master chain: plugins over the summed mix, in order, before it leaves for the
interface. The song's graph has two built-in outputs — MIX, where every lane's chain ends, and OUT, the
device — and a chain wired between them arrives in this field. Empty is the ordinary case and means the
two are one wire.

They go on the master plugin list **before** the meter and the broadcast tap, and therefore before
`MasterGainPlugin`: those process the mix, this one trims the delivery. The song side of it is
`packages/song/docs/masterChain.md`.

### `tracks` — the delta, and what it deliberately cannot do

A sender that rewrites a handful of lanes several times a second while the rest of the song sits
still would pay, with `project`, 137 KB of document parsed and diffed to say eight notes moved,
against 3.7 KB of `tracks`.

The engine **merges into the document it holds and then runs the same `apply`**. That is what
makes this cheap and boring at once: the diff, the incremental paths and the rebuild fallback are
untouched, and there is no second way for a project to reach the engine — only a shorter way to
say what moved.

It **replaces by id**, and can neither add nor remove a track. Three consequences, all deliberate:

- an id the session does not hold is a DISAGREEMENT — the brain believing we hold a project we do
  not, which is what a restart looks like — so it is warned about and dropped. Appending would
  hide exactly the case the reconnect re-send exists for;
- a session holding nothing answers `error`, rather than starting a song out of a fragment;
- the sender is responsible for a whole `project` whenever the SET of tracks changes, and must
  forget the ids it last sent whenever the socket reopens, since a fresh socket can mean a fresh
  engine.

Nothing sends it: pattern lanes are played by the engine itself (`patternPlugin.md`). It stays
because it costs nothing unused and a live source of notes from outside the engine would want
exactly this.

No `busy` and no `applied` come back. This path is incremental by construction, and announcing a
changeset six times a second would drown the one that matters — the full-document path still
announces its own. `engine/k7-runtime/scripts/track-delta.ts` exercises the three answers.

### The numbers are bounded where they arrive

`docFromJson` is a trust boundary, not a formality: under the supervisor the engine binds `0.0.0.0`,
so a document can come from anything on the LAN. What Tracktion divides by or the builder loops over
is bounded there, with a `warn()` when a value is replaced:

| field | bound | what an unbounded one does |
|---|---|---|
| `timeSigNumerator` / `timeSigDenominator` | 1..64 over a power of two up to 32, else 4/4 | `240 / (bpm * 0)` inside Tracktion |
| `tempo` | finite and positive, else 120 | Tracktion clamps the rest itself |
| `sampleRate` | 8 000..768 000, else 48 000 | a rebuild that opens nothing |
| a note's `key`, a rack entry's `note` | 0..127 | a MIDI number that means nothing |
| a pad's `repeat` / `skip` | 0..64 | a loop writing that many notes on the message thread |
| a tap output's `pair`, a track's `inputFrom.pair` | 0..31, the sampler's own range | a rack grown to that many outputs |

Every PATH a document names is held to the engine's roots in the same place — dropped, with a
warning, when it falls outside them (`docs/pathRoots.md`).

A repeated id is renamed rather than trusted: the second track, module or clip carrying one becomes
`id#2`, then `#3`, in document order, with a warning. Every map downstream — the diff, the lanes, the
modules, the send buses — is keyed by id, and a second entry would be diffed, routed and metered as
the first. Modules share one namespace per session, the master chain's included; clips are unique
per track. The renaming is deterministic, so a re-sent document diffs as the same one.

`EditBuilder` bounds the one count that is DERIVED rather than sent: a clip's unrolled passes, at
4096. `tests/DocJson_test.cpp` pins the table.

Before any of that, EVERY message is held to 64 levels of nesting (`parseMessage` in `DocJson.cpp`),
refused while it is parsed. The parser itself is iterative, but copying or walking a JSON value
recurses, and a few kilobytes of brackets is enough to overflow a connection thread's stack — an
overflow no `catch` sees, which a client re-sending the message turns into a crash loop. A project
document nests about ten deep.

## server → client

Every JSON push to a client goes through `Outbox.h`'s single writer thread, never out of the thread
that produced it: a server-side send blocks until the peer drains, and the message thread must never
be the one waiting (`docs/audit-stabilite.md`). The order of one client's messages is kept; a state
frame is skipped for a socket already behind, a reply never is.

| message | meaning |
|---|---|
| `{ type: "applied", changes: ["tempo -> 124 bpm", …], warnings: [{ subject, message }] }` | the diff that ran, and the STANDING warnings the session's project was built with (`sessions.md`) |
| `{ type: "flushed" }` | flush completed |
| `{ type: "sessions", sessions: [{ id, project, loaded, playing, tracks, listeners }] }` | every session held. `listeners` is counted in `server/ServeMachine.cpp` — who is subscribed to audio is a property of the SOCKETS, which the engine layer never sees |
| `{ type: "state", playing, playhead, loop, levels, inputLevels, waveform }` | the ~20 Hz state frame; `loop` is `{ on, start, end }` in seconds, the transport's own, so a client that reconnects draws the loop that is playing rather than none |
| `{ type: "plugin-params-live", id, params }` | the watch feed, while a value moves |
| `{ type: "plugin-params", id, params, meta }` | the state to persist; `meta` only on the get- reply |
| `{ type: "plugin-base-saved", format, id, path, ok }` | whether the snapshot wrote. `ok:false` leaves no file — no instance open, or a plugin with no state to give |
| `{ type: "native-plugin-ui-opened", format, id, ok }` | whether the orphan window opened. NO reply at all means the load is still running or has hung — the two a caller must not read as success |
| `{ type: "presets", module, presets: [{name,source,index,path}, …] }` | |
| `{ type: "edit-plugins", plugins: [{id,name,hasNativePluginUI}, …] }` | what the loaded project holds |
| `{ type: "plugins", plugins: […], scanning }` | the installed catalogue; `scanning` says a scan is running and will broadcast the list it ends on |
| `{ type: "plugin-scan", scanning, done, total, current, version }` | where the plugin scan stands: files done of `total` listed (0 while listing), the file being loaded, and the scans this process has finished. Broadcast at a scan's start, when a load begins, at most 4 Hz in between, and at the end — after the `plugins` it ended on |
| `{ type: "busy", busy: true\|false }` | the message thread is (un)blocked by an apply |
| `{ type: "error", message }` | |

### `whoami` answers off the message thread

The identity probe goes back to the **asking socket alone**, so a browser measuring candidate
engines does not spam every client. The token proves this is the real engine for that id; the
registry verifies it server-side on select.

It also carries `boot`, the start time of this PROCESS. `id` names the machine's engine and stays
the same when the supervisor relaunches a crashed one; `boot` does not. A browser that reconnects
and meets another `boot` knows the engine died under it, and k7 says so in a toast — a dropped
network and a crash otherwise look identical from the browser, and only the second lost the song.

It carries the audio timing in the same reply because the browser is timing *this* round trip to
get the network half and needs the interface half from the same breath — a second query would
measure a second, warmer trip.

And it is answered **without posting to the message thread**. Posting would put the probe behind
whatever the engine is doing, turning the ping into a measure of its queue. That is only safe
because `audioTiming()` reads two atomics the message thread publishes: dereferencing the live
device here would race a concurrent `set-audio-device`, which destroys it — and this keepalive
fires every few seconds on every socket.

### The state frame slows to 4 Hz when a session is idle

`~20 Hz` is the rate while something is happening. `StateTimer` still ticks every 50 ms — the
abandoned-project and empty-session sweeps ride it — but it only *sends* one tick in five while
a session is **idle**, which means all of:

- not playing, not record-enabled, nothing armed;
- no waveform tap in the chain and no watched plugin parameter (`sessionWatched`) — those two
  carry new numbers even with the transport stopped;
- every output and input level under **−60 dB**. This clause is not implied by the first: an
  *audition* sounds without the transport rolling, and a monitored input moves a meter while it
  does.

At every 50 ms regardless, a browser pays for all of it — parse, then every subscriber's
selector, to conclude nothing has moved. 4 Hz is slow enough to leave a
profile and quick enough that a change made from another tab lands within 250 ms. Nothing is
drained or pumped on a skipped tick, which is safe precisely because a tap or a watch is what
makes a session non-idle.

A client must not read the cadence as a signal: it is not a heartbeat, and
`packages/engine-browser`'s store drops an identical frame anyway (`docs/meters.md`).

### …and it goes only to the sockets that asked about that project

The state frame is the one reply nobody requested, so it is the only one addressed by SOCKET
rather than by verb. `Serve.cpp` remembers which session each connection named in its first real
message — the same test that earns it a `[client] connected` line — and sends each frame to those
sockets alone. A plain `broadcast` here makes every socket on the port decode every session's
meters and waveform envelopes before its own `forSession` drops them; and since the idle divider
above is *per session*, one session playing keeps every other session's tabs awake at 20 Hz. On a
machine holding three sessions (`scripts/two-sessions.ts`, which counts frames on a raw socket)
that is 200 frames received per socket in nine seconds, 34 of them wanted.

The test is deliberately not `role: "driver"` — the file service declares nothing (its link would
otherwise count as a driver and no project would ever look abandoned). And it binds once per socket: `drop-session` and `show-native-plugin-ui` carry
another session's id as an override, and a socket that rebound on those would go deaf.

A probe — the supervisor asking for devices and hanging up — names nothing and gets nothing, which is
what it wants.

Misrouting is deliberately not a correctness hazard: every client still runs `forSession`
(`@studio/engine-protocol/sessions`) over what arrives. The `subscribers` map decides what to
**send**, never what is legal to read — so a socket that has not spoken yet costs a frame, never a
wrong meter. The same holds for its raw-pointer keys: an entry outliving its socket could be
matched by a later one the allocator put at the same address, and the cost is one frame that
socket's own filter drops.

## server -> client, BINARY

One message type, and the only binary this socket carries: a frame of master audio, sent
only to connections that asked with `broadcast`. A 32-byte header then interleaved
float32 — the format lives in `packages/engine-protocol/stream.ts` and is mirrored in
`server/AudioSender.cpp`'s `encodeStreamFrame`. The two must agree byte for byte, and nothing
checks that they do but a listener. See docs/broadcast.md.
