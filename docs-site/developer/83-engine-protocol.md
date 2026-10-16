# The engine protocol

Every client talks to the engine over one WebSocket: JSON text messages both ways, plus binary messages for the audio broadcast. The TypeScript shapes live in `packages/engine-protocol`; the engine's handlers in `engine/k7-runtime/server/` are the authority on the full set, since each client implements only the subset it needs.

## The package

`packages/engine-protocol` is one of the four packages published for z0 (as raw TypeScript). Its subpaths:

| Subpath | File | Content | Emits code |
|---|---|---|---|
| `.` | `types.ts` | `EngineState` (the state frame), `EngineLoad`, `RecorderState`, `WaveformEnvelope`, `TransportAction`, `ParamMeta`, `PluginParams`, `PresetInfo` | no |
| `./project` | `project.ts` | The `ProjectDoc` tree: `ProjectDoc`, `TrackDoc`, `ClipDoc`, `PluginDoc`, `NoteDoc`, `WarpDoc`, `EventDoc`, `SendDoc`, `AutomationDoc`, `GroupDoc`, `SettingsDoc`, `Marker`, `RackSoundDoc` | no |
| `./build` | `build.ts` | Constructors (`emptyDoc`, `trackDoc`, `clipDoc`, `pluginDoc`, `enginePlugin`) and shared constants (`EXTERNAL_PLUGIN_FORMATS`, built-in plugin names, `MIXER_PARAMS`, `VOLUME_DB`, metronome defaults) | yes |
| `./sessions` | `sessions.ts` | Session ids: `DEFAULT_SESSION`, `SESSIONS`, `sessionFor`, which replies are machine-wide | yes |
| `./stream` | `stream.ts` | The binary audio frame: `encodeStreamFrame`, `decodeStreamFrame`, `seqGap` | yes |

The type-only subpaths are erased at runtime. `@studio/song` re-exports the `ProjectDoc` types and owns the compiler that produces them; `./build` exists for callers with no song folder (a module preview is a one-track doc, a DJ desk two tracks).

## Sessions

One engine plays several projects, one per session. Every message may carry `session`; absent means `""` (`DEFAULT_SESSION`, which must stay unnamed because the engine reads an absent field as `""`).

```ts
import { sessionFor, SESSIONS } from "@studio/engine-protocol/sessions";
sessionFor(SESSIONS.k7, "fred@example.org"); // "k7:fred_example_org"
```

`sessionFor(service, who)` slugs the email the same way the file service names a user's folder. `SESSIONS` has `k7`, `pl8` (the media library) and `banc` (the bench, a session of its own so it plays beside the person's song). A share visitor gets `share:<random>`.

Replies listed in `ENGINE_GLOBAL_REPLIES` (`plugins`, `audio-devices`, `sessions`, …) are about the machine and carry no session; per-session replies are stamped with the session and filtered by `forSession()` on the client.

## Messages to the engine

| `type` | Fields | Effect |
|---|---|---|
| `whoami` / `hello` | `role?: "driver"` | Replies `whoami {id, token, boot, bufferSize, sampleRate, audioToBrowser}` to the asking socket. `role: "driver"` counts the socket as driving the session. |
| `project` | `doc` | Apply a whole `ProjectDoc` (diffed). Broadcasts `busy`, `applied {changes}`, `busy:false`. |
| `tracks` | `tracks: TrackDoc[]` | Replace those tracks in the held doc and apply; no `busy`/`applied` |
| `flush` | | Replies `flushed` once earlier work is done |
| `transport` | `action`: `play`, `stop`, `toggle`, `rewind`, `panic`, `seek` (`position` s), `loop` (`start`, `end`, `enabled`) | Transport |
| `preview` | `file`, `start`, `length` | Audition a file |
| `note-preview` | `track`, `key`, `vel` | Audition one note through a track |
| `midi-live` | `track`, `data: number[]` | One live MIDI message into a track's chain |
| `arm` | `track`, `armed` | Record-arm a track |
| `record-enable` | `enabled?` | The session's record enable (toggles when absent) |
| `recorder` | `node`, `action`, `on?` | Drive a recorder node |
| `list-plugins` / `rescan-plugins` | `filter?`, `force?` | Replies `plugins` |
| `list-plugin-params` | `format`, `id` | Replies `plugin-param-list` |
| `get-plugin-params` | `id` | Replies `plugin-params` with `meta` |
| `set-plugin-param` | `id`, `name`, `value` | Set one parameter live |
| `watch-plugin-params` | `id`, `on` | Stream `plugin-params-live` for a plugin |
| `list-presets` / `set-preset` | `module`; `index` or `path` | Replies `presets` |
| `snapshot-plugin-base` | `format`, `id`, `path` | Save a plugin's state; replies `plugin-base-saved` |
| `list-edit-plugins` | | Replies `edit-plugins` (plugins with an openable window) |
| `show-native-plugin-ui` / `show-native-plugin-ui-of` | `id` (and `format`) | Open a plugin window on the engine machine |
| `subscribe-waveform` / `unsubscribe-waveform` | `id`, `side` | Waveform envelopes in the state frame |
| `broadcast` | `on` | Start or stop the binary audio broadcast to this socket |
| `list-sessions` / `drop-session` | | Replies `sessions` / drops the named session |
| `list-audio-devices` / `set-audio-device` | `name`, `deviceType` | Replies `audio-devices` to everyone |
| `io-levels` | `channels: number[][]` | Replies `io-levels {inputs, found, pitches, clarity, devices, master}` |
| `set-input-stereo` | `channel`, `stereo` | Group or split an input pair |
| `instrument-status` | `refs: string[]` | Replies whether each `@instruments/` ref is installed |
| `audio-cost` | `reset?` | Replies the audio callback's cost |
| `pair-request`, `pair`, `pair-approve`, `pair-deny`, `unpair-device`, `list-pair-requests`, `list-paired-devices` | see below | Pairing |

`track-mix` is sent by `@studio/engine-browser` only to a share's player in k7's backend, which applies a visitor's mute and solo to its own session; the engine refuses it as unknown.

## Messages from the engine

| `type` | Meaning |
|---|---|
| `state` | The ~20 Hz push: `EngineState` in `types.ts` (playing, playhead, loop, per-track output and input levels, armed tracks, record enable, master level and clip latch, waveform envelopes, platter positions, recorder states; `load` every fourth frame) |
| `busy`, `applied`, `flushed` | Project application progress |
| `plugins`, `plugin-param-list`, `plugin-params`, `plugin-params-live`, `presets`, `plugin-base-saved`, `edit-plugins`, `native-plugin-ui-opened` | Plugin replies |
| `audio-devices`, `io-levels`, `sessions`, `audio-cost`, `instrument-status` | Machine replies |
| `armed`, `recorded` | Recording news; a `recorded` take names an absolute path on the engine machine |
| `pair-pending`, `paired`, `pair-denied`, `pair-requests`, `paired-devices` | Pairing |
| `engine-warning` | A warning stamped with its session (a missing instrument, an unknown track id) |
| `error` | `message`, and `code` for refusals (`unpaired`, `local-only`, `busy`, `not-needed`) |

## Pairing

Trust is decided per socket in `engine/k7-runtime/server/ServePairing.cpp`:

- At the handshake, a browser page whose `Origin` is not allowed (see [81](./81-k7-runtime.md#inside-serve)) is closed before any message is read.
- A **loopback** peer is trusted and "local". Traffic relayed through the tunnel or WebRTC arrives from the supervisor on loopback, already authenticated by the server.
- Any other peer must first send `{type:"pair", key}`. The key is either a paired device's key or the engine's own token (what the server's relay holds when it dials over the LAN).
- An untrusted peer may send at most 16 KiB per frame. To `whoami` it gets `{id, boot, needsPairing: true}` and never the token; everything else is refused with `code: "unpaired"`.
- `pair-request {name}` from a LAN peer creates a request with a 6-digit code (replied as `pair-pending {requestId, code}`) and pushes `pair-requests` to local sockets. Requests expire after 2 minutes; at most 8 wait. `pair-approve` answers the requesting socket with `paired {deviceId, name, key}`; the key is stored in the browser's `localStorage` under `k7.engine-pair.<engineId>`.
- `pair-approve`, `pair-deny`, `unpair-device`, `list-pair-requests`, `list-paired-devices` are local-only. Revoking closes the device's live sockets.

Paired devices persist in `<state>/paired-devices.json`.

## The audio broadcast

A socket that sends `broadcast {on: true}` receives the session's master output as binary messages: a 32-byte header (magic `"LSTR"`, version 1, channels, sample rate, frames per channel, a wrapping sequence number, codec, and the engine's steady clock in ms) followed by interleaved float32 PCM (`STREAM_CODEC_PCM_F32`). A gap in `seq` is always the sender dropping under backpressure, never a loss in flight. The server's engine sets `audioToBrowser` in `whoami`, and `@studio/engine-browser/engine-output` then plays the broadcast in the page. Closing the socket removes the listener, and the last one leaving turns the tap off.

## Adding a message

1. Add a handler with `t.add({"my-verb"}, …)` in the `Serve*.cpp` file for its concern. Do engine work inside `host.post(...)`, never on the socket's thread, and reply with `broadcastTo(session, …)` for per-session news or `ws.send` for the asker alone.
2. If it is a read-only probe that clients poll, add it to `probeQueries` in `engine/k7-runtime/server/Serve.cpp` so it neither logs a connection nor creates a session.
3. Put any shared payload type in `packages/engine-protocol/types.ts`.
4. Add the sender to `packages/engine-browser/src/engine.ts` and, if a Node service needs it, `packages/engine-client/src/engineControl.ts`. Methods that do not need a `ProjectDoc` belong in `EngineControl`, so they do not drag the compiler in.
5. If the reply is machine-wide, add it to `ENGINE_GLOBAL_REPLIES` in `packages/engine-protocol/sessions.ts`.

Nothing type-checks across the C++ boundary: run the engine and exercise the verb.
