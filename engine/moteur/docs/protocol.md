# The engine's WebSocket protocol (`server/main.cpp`)

`studio-moteur` is a headless audio server: a thin WebSocket bridge over
`studio::engine`, speaking JSON. The engine does not parse files — the Node brain
interprets the song, resolves clip paths to absolute, and sends the project as JSON.

`main.cpp` includes **no** JUCE or Tracktion headers: all engine threading sits behind
`EngineHost`'s `post()` / `onState()` / `run()` API.

## Every message carries a session

`{ "session": "m9", … }` on any message names **which project on this engine** it is
about. One process hosts several (`docs/multiEdit.md`), so without it the médiathèque's
module preview and an m9 deck would each replace whatever l8 had loaded.

The field is optional and absent means `""`, the default session — so a client that has
never heard of sessions keeps working exactly as before, which is what let the engine grow
this before the clients did.

**Every reply about one project carries it back**, and only these five do not, because they are
the machine's rather than a project's: `plugins`, `audio-devices`, `sessions`, `edit-plugins`
and `whoami`. That is a closed set — it is `ENGINE_GLOBAL_REPLIES` in
`packages/engine-protocol/sessions.ts`, with `PER_SESSION_REPLIES` beside it, and
`sessions.test.ts` pins both. It matters that the set is closed: the client's filter passes a
frame with **no** session at all (so an older engine does not strike it deaf), which is safe
only for as long as this engine stamps everything else. In `main.cpp` the choice is a verb —
`broadcast` or `broadcastTo`.

A session is created by a client **driving** one — sending a project, subscribing to its audio,
enabling record — and never by asking about one: reads go through the non-inserting accessor, so
a supervisor that polls this engine does not conjure sessions by watching it. They are dropped
with `{"type":"drop-session"}`, and an EMPTY one is reaped after ten idle minutes. Each has its
own edit, plugins, meters, watch set, record enable and **broadcast tap**: an audio listener
hears the session it subscribed for, not the machine's master.

The engine's own half of this — the registry's threading model and the lifecycle rule — is
`docs/sessions.md`. Client rules, who picks the name, and why l8's two halves must agree on it
are in `packages/engine-protocol/docs/sessions.md`.

## client → server

| message | meaning |
|---|---|
| `{ type: "project", doc: {…ProjectDoc…} }` | set or update the song |
| `{ type: "tracks", tracks: [{…TrackDoc…}] }` | replace just these tracks in the song already held — see below |
| `{ type: "flush" }` | forget the song entirely |
| `{ type: "transport", action: "play" \| "stop" \| "toggle" \| "rewind" }` | bare transport verbs |
| `{ type: "transport", action: "seek", position: 12.5 }` | seconds |
| `{ type: "transport", action: "loop", start: 4, end: 8, enabled: true }` | loop region, in seconds |
| `{ type: "preview", file: "/abs/kick.wav", start: 0, length: 0 }` | audition a sample |
| `{ type: "watch-plugin-params", id: "chain:module", on: true }` | follow a plugin's values live |
| `{ type: "subscribe-waveform", id, side: "input"\|"output", trackIndex }` | tap a module's audio |
| `{ type: "unsubscribe-waveform", id, side }` | drop that tap |
| `{ type: "list-presets", module: "synth" }` | → a `presets` reply |
| `{ type: "set-preset", module: "synth", index: 3, path: "" }` | pick a preset |
| `{ type: "list-edit-plugins" }` | → an `edit-plugins` reply. Engine-global: it answers for EVERY session, each row naming its own, because a supervisor asking drives none of them |
| `{ type: "arm", track, armed }` | arm a track for recording → `armed`, or an `error` |
| `{ type: "record-enable", enabled: true }` | whether rolling this session records → `record-enabled` |
| `{ type: "get-plugin-params", id }` / `{ type: "set-plugin-param", id, name, value }` | read / move one plugin's values |
| `{ type: "io-levels", channels: [[1,2]] }` | input meters + tuner, plus THIS session's master level |
| `{ type: "list-audio-devices" }` / `{ type: "set-audio-device", name, deviceType }` | the machine's interface. Engine-global — one device per process |
| `{ type: "rescan-plugins" }` | re-scan the installed catalogue |
| `{ type: "whoami" }` | identity probe, answered to the asking socket alone |
| `{ type: "hello", role: "driver" }` | the same probe, **and** "a person is looking at this session" — the engine frees a project 45 s after its last driver goes. Omit `role` and nothing is counted, which is how the file service and every prober stay out of it. See [sessions.md](sessions.md). |
| `{ type: "list-sessions" }` | → a `sessions` reply. Engine-global: it is the one question whose answer is about the OTHER sessions |
| `{ type: "drop-session", session: "m9" }` | forget a session outright — edit, plugins, meters and tap. → `session-dropped` |
| `{ type: "show-native-plugin-ui", id: "chain:module" }` | open the plugin's own window |
| `{ type: "show-native-plugin-ui-of", format, id }` | the same window for a plugin in NO project — an ORPHAN instance on the offline engine, saved nowhere. `format`+`id` name a binary, as `list-plugin-params` does |
| `{ type: "snapshot-plugin-base", format, id, path }` | keep what that orphan is holding: its state written to `path` as a `.vstpreset`. Refuses when no window was opened — see `plugin-base-saved` |
| `{ type: "broadcast", on: true }` | send me the master audio (this connection only) |

### `tracks` — the delta, and what it deliberately cannot do

The pattern clock rewrites a handful of lanes' clips six or seven times a second while the rest
of the song sits still. It used to send `project` each time: 137 KB of document parsed and diffed
to be told about eight notes, against 3.7 KB of tracks.

The engine **merges into the document it holds and then runs the same `apply`**. That is what
makes this cheap and boring at once: the diff, the incremental paths and the rebuild fallback are
untouched, and there is no second way for a project to reach the engine — only a shorter way to
say what moved.

It **replaces by id**, and can neither add nor remove a track. Three consequences, all deliberate:

- an id the session does not hold is a DISAGREEMENT — the brain believing we hold a project we do
  not, which is what a restart looks like — so it is warned about and dropped. Appending would
  hide exactly the case the reconnect re-send exists for;
- a session holding nothing answers `error`, rather than starting a song out of a fragment;
- the sender is responsible for a whole `project` whenever the SET of tracks changes.
  `PatternClock` keeps the ids it last sent and falls back on any difference; it also forgets them
  whenever the socket reopens, since a fresh socket can mean a fresh engine.

No `busy` and no `applied` come back. This path is incremental by construction, and announcing a
changeset six times a second would drown the one that matters — the full-document path still
announces its own. `engine/moteur/scripts/track-delta.ts` exercises the three answers.

## server → client

| message | meaning |
|---|---|
| `{ type: "applied", changes: ["tempo -> 124 bpm", …] }` | the diff that ran |
| `{ type: "flushed" }` | flush completed |
| `{ type: "sessions", sessions: [{ id, project, loaded, playing, tracks, listeners }] }` | every session held. `listeners` is counted in `main.cpp` — who is subscribed to audio is a property of the SOCKETS, which the engine layer never sees |
| `{ type: "session-dropped", session }` | a session was forgotten |
| `{ type: "state", playing, playhead, levels, inputLevels, waveform }` | the ~20 Hz state frame |
| `{ type: "plugin-params-live", id, params }` | the watch feed, while a value moves |
| `{ type: "plugin-params", id, params, meta }` | the state to persist; `meta` only on the get- reply |
| `{ type: "plugin-base-saved", format, id, path, ok }` | whether the snapshot wrote. `ok:false` leaves no file — no instance open, or a plugin with no state to give |
| `{ type: "presets", module, presets: [{name,source,index,path}, …] }` | |
| `{ type: "edit-plugins", plugins: [{id,name,hasNativePluginUI}, …] }` | what the loaded project holds |
| `{ type: "busy", busy: true\|false }` | the message thread is (un)blocked by an apply |
| `{ type: "error", message }` | |

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

The frame was going out every 50 ms regardless, and a browser paid for all of it — parse, then
every subscriber's selector, to conclude nothing had moved. 4 Hz is slow enough to leave a
profile and quick enough that a change made from another tab lands within 250 ms. Nothing is
drained or pumped on a skipped tick, which is safe precisely because a tap or a watch is what
makes a session non-idle.

A client must not read the cadence as a signal: it is not a heartbeat, and
`packages/engine-browser`'s store drops an identical frame anyway (`docs/meters.md`).

### …and it goes only to the sockets that asked about that project

The state frame is the one reply nobody requested, so it is the only one addressed by SOCKET
rather than by verb. `main.cpp` remembers which session each connection named in its first real
message — the same test that earns it a `[client] connected` line — and sends each frame to those
sockets alone. It used to `broadcast`, so every socket on the port decoded every session's meters
and waveform envelopes before its own `forSession` dropped them; and since the idle divider above
is *per session*, one session playing kept every other session's tabs awake at 20 Hz. Measured on
a machine holding three sessions (`scripts/two-sessions.ts`, which now counts frames on a raw
socket): 200 frames received per socket in nine seconds, 34 of them wanted.

Deliberately not `role: "driver"` — the file service declares nothing (its link would otherwise
count as a driver and no project would ever look abandoned) and its pattern clock runs off these
frames. And deliberately once per socket: `drop-session` and `show-native-plugin-ui` carry another
session's id as an override, and a socket that rebound on those would go deaf.

A probe — the tray asking for devices and hanging up — names nothing and now gets nothing, which
is what it always wanted.

## server -> client, BINARY

One message type, and the only binary this socket carries: a frame of master audio, sent
only to connections that asked with `broadcast`. A 32-byte header then interleaved
float32 — the format lives in `packages/engine-protocol/stream.ts` and is mirrored in
`server/main.cpp`'s `encodeStreamFrame`. The two must agree byte for byte, and nothing
checks that they do but a listener. See docs/broadcast.md.
