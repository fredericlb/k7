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
| `{ type: "list-sessions" }` | → a `sessions` reply. Engine-global: it is the one question whose answer is about the OTHER sessions |
| `{ type: "drop-session", session: "m9" }` | forget a session outright — edit, plugins, meters and tap. → `session-dropped` |
| `{ type: "show-native-plugin-ui", id: "chain:module" }` | open the plugin's own window |
| `{ type: "broadcast", on: true }` | send me the master audio (this connection only) |

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
| `{ type: "presets", module, presets: [{name,source,index,path}, …] }` | |
| `{ type: "edit-plugins", plugins: [{id,name,hasNativePluginUI}, …] }` | what the loaded project holds |
| `{ type: "busy", busy: true\|false }` | the message thread is (un)blocked by an apply |
| `{ type: "error", message }` | |

## server -> client, BINARY

One message type, and the only binary this socket carries: a frame of master audio, sent
only to connections that asked with `broadcast`. A 32-byte header then interleaved
float32 — the format lives in `packages/engine-protocol/stream.ts` and is mirrored in
`server/main.cpp`'s `encodeStreamFrame`. The two must agree byte for byte, and nothing
checks that they do but a listener. See docs/broadcast.md.
