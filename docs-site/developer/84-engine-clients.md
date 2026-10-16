# Engine clients

Two packages speak the [engine protocol](./83-engine-protocol.md): `@studio/engine-client` in Node, used by the server-side services, and `@studio/engine-browser` in the browser, used by every page that drives an engine. Each is the only implementation for its runtime. Keeping two browser clients in step was tried and they diverged, so any browser surface that drives the engine uses `engine-browser`.

## `@studio/engine-client` (Node)

`packages/engine-client/src/`, consumed as source through its `exports`:

| Subpath | What |
|---|---|
| `./engineControl` | `EngineControl`: the WebSocket link minus the project. Connect, send a command, emit the reply as an event. Messages sent before the socket opens are buffered (at most `ENGINE_OUTBOX_MAX` = 200, each dropped after `ENGINE_OUTBOX_TTL_MS` = 30 s). Methods: `transport`, `preview`, `arm`, `setRecordEnabled`, `flush`, `listPlugins`, `rescanPlugins`, `listPluginParams`, `snapshotPluginBase`, `listEditPlugins`, `showNativePluginUI`, `showNativePluginUIOf`, `watchPluginParams`, `listSessions`, `dropSession`, `listAudioDevices`, `setAudioDevice`, `ioLevels`, `setInputStereo`, `close`. |
| `./engineClient` | `EngineClient extends EngineControl` adding `sendProject(doc)`, which folds groups onto their members (`withGroupMix`) before sending. It imports `@studio/song` (the compiler, a few MB), which is why it is a separate subpath: a process that only asks questions imports `engineControl` and carries none of it. |
| `./engineBinary` | `findEngineBinary()`: `$STUDIO_ENGINE`, then a copy beside a packaged bundle, then the newest build under `engine/k7-runtime/build/*/` (Debug last) |
| `./paths` | The `~/.k7` layout (twin of the supervisor's `Paths.cpp`): `studioDir`, `rootDir`, `mediatekDir`, `webEndpointsDir`, `slugify` |
| `./pluginCache` | Reading `exts.json` |

The main consumer is `packages/file-service` (`packages/file-service/src/engineLink.ts` holds each workspace's link to its bound engine), plus `packages/commands`' test host, `packages/audio-passes` and `packages/engine-registry/advertise.ts`.

## `@studio/engine-browser` (browser)

`packages/engine-browser/src/`, published for z0 like `engine-protocol`, with React as a peer dependency.

| Subpath | File | What |
|---|---|---|
| `.` | `engine.ts` | `EngineClient`: the browser WebSocket link |
| `./access` | `access.ts` | `engineAccess(base, json, opts)`: the one object an app uses to reach engines |
| `./probe` | `probe.ts` | Measure engines over every candidate address |
| `./choose` | `choose.ts` | `chooseEngine`, `bestEngine`: the selection policy, pure |
| `./lease` | `lease.ts` | `holdEngine`: keep the claim on an engine for a project |
| `./registry` | `registry.ts` | The registry's five routes, and `ClaimLost` |
| `./store` | `engineStore.ts` | `EngineStore` + `useEngineState(selector)`: the 20 Hz state as an external store |
| `./params` | `params.ts` | `PluginParamsStore`: live parameter values, same pattern |
| `./meter` | `meter.ts` | Meter arithmetic: dB to fill, clip latch |
| `./compat` | `compat.ts` | Fetch an engine's plugin catalogue and score a project against it |
| `./pairing` | `pairing.ts` | LAN pairing keys and `requestPairing` |
| `./relook` | `relook.ts` | `useRelook()`: when to measure again (every 15 s and on tab focus) |
| `./stream`, `./stream-sink`, `./engine-output` | `streamPlayer.ts`, `streamSink.ts`, `engineOutput.ts` | Playing the engine's binary audio broadcast in the page |
| `./playhead-clock` | `playheadClock.ts` | A playhead predicted from local time, corrected by state frames |

### `EngineClient`

`new EngineClient(url, …)` takes an `EngineUrl`: a string, or a function asked again before **every** connection attempt. A relayed URL carries a ticket valid for a minute, so reconnecting with the URL measured at load would fail; `access.linkUrl(chosen)` returns a function that hands out the measured URL once and then asks the registry for a fresh one.

It reconnects with backoff (`ENGINE_RECONNECT_MIN_MS` 1 s to `ENGINE_RECONNECT_MAX_MS` 30 s), pings an idle socket every 10 s and drops it after 5 s without an answer, and gives each connection attempt a 10 s deadline. On every open it sends the pairing key first when this browser holds one, then `whoami`. A change of the engine's `boot` id fires `onEngineRestart`, which is how k7 knows to resend the project after a crash. Every per-session reply is filtered with `forSession()`.

Senders: `transport`, `seek`, `loop`, `sendProject`, `flush`, `previewNote`, `liveMidi`, `recorder`, `setRecordEnabled`, `trackMix`, `dropSession`, plugin calls (`listPlugins`, `listPluginParams`, `getPluginParams`, `watchPluginParams`, `setPluginParam`, `listPresets`, `setPreset`), `subscribeWaveform`/`unsubscribeWaveform`, `broadcast`, `ioLevels`, `instrumentStatus`, and the pairing verbs. Listeners: `onState`, `onBusy`, `onWarning`, `onEngineRestart`, `onConnected`, `onAudioToBrowser`, `onStreamFrame`, `onIoLevels`, `onPlugins`, `onPluginParamList`, `onPluginParams`, `onPluginParamsLive`, `onPresets`, `onInstrumentStatus`, `onPairRequests`, `onPairedDevices`.

### The state store

A 20 Hz frame held in React state re-rendered the whole tree on every frame. `EngineStore` is an external store; components subscribe to the slice they draw with `useEngineState(selector)` (`useSyncExternalStore`), so the editor itself never re-renders on a frame. Recorder takes are accumulated in the store (`takeEnvelope.ts`) because the engine sends only the points made since the last frame, and resends the whole picture in one frame when a socket connects, before any component that draws it exists.

### Access, probe, choice and lease

`engineAccess(base, json, { prefsBase?, hostedFiles? })` binds everything to the registry's origin once (k7 passes its own origin, which hosts the registry):

| Method | Does |
|---|---|
| `list()`, `select()`, `release()`, `prefs()`, `savePrefs()` (replaces), `patchPrefs()` (merges one field) | The registry routes (`/api/engines`, `/api/engine/select`, `/api/engine/release`, `/api/preferences`) |
| `probe(engines)` | Measure each engine; with `hostedFiles`, also attach the server's file hub and a ticket |
| `find(preferId?)` | List, read the preference, probe, apply `chooseEngine`: returns `{ranked, rememberedId, chosen, ambiguous}`. A silent registry reads as no engines. |
| `hold(chosen, {project, onLost})` | Claim and keep renewing the claim; returns the release |
| `wsUrlFor(id)`, `linkUrl(chosen)` | A fresh address for one engine |
| `hostedFiles()`, `freshTicket()` | The server's file hub address and ticket (`FILE_HUB_HELLO`), cached six hours |

**Probe** (`probe.ts`): for each engine, every candidate is tried at once (loopback; LAN IPs only on an `http:` page; the relay `wss://…/api/engine/<id>/ws?ticket=…`; `rtc:…/api/engine/<id>/rtc` when the registry says the engine has a tunnel), and the fastest `whoami` that **matches the expected id** wins, so a lookalike listener cannot pass. Timeout: 3 s. The latency is the round trip plus twice the reported buffer period (`engineLatency` in `packages/web-protocol/quality.ts`), banded Q1 (< 20 ms), Q2 (< 50 ms), Q3. A reply with `needsPairing` marks the row as reachable but unusable until paired.

**Policy** (`choose.ts`): anyone may register an engine, so only a **trusted** engine is ever taken without a click. `mayAutoPick(r, remembered)` is true for the account's remembered engine, for one `reachedDirectly` (answered on a plain `ws:` socket to one of its own loopback or private LAN addresses, never the relay or WebRTC), and for the server's own engine (`engine.server`, set by the registry for the tunnel holding the render key). `chooseEngine` takes the remembered engine if it answered, else the only reachable one if it may be auto-picked, else reports `ambiguous`. `bestEngine`, which k7's `EngineGate` uses, sorts candidates (reachable, with a token, not `assigned`, and `mayAutoPick`) by compatibility with the project, then the remembered id, then "on this machine" (answered over loopback), then quality band, then performance score, then milliseconds.

**Lease** (`lease.ts`): `select` without a secret opens a claim and always wins (the newcomer takes over); renewing every `ENGINE_ASSIGN_RENEW_MS` (5 s) with the secret can be refused. A refusal (`ClaimLost`) carries why: `project` (the project was opened elsewhere), `engine` (another project took the engine; `tookFor` names it) or `lapsed` (the claim aged out after `ENGINE_ASSIGN_TTL_MS`, 90 s), after which the loop simply reopens. On `project` or `engine`, `onLost` is called once and the caller must stop driving. `release` goes by `sendBeacon` from a closing page.

### WebRTC socket

`rtcSocket.ts` gives a WebSocket-shaped object over an `RTCPeerConnection` data channel (ordered, label `engine`), created with `iceServers: []`. It gathers candidates for up to 1.5 s, posts the offer to the registry's `/engine/<id>/rtc`, and applies the SDP answer the supervisor returns through its tunnel. Messages are cut into fragments (`packages/web-protocol/rtcFrames.ts`) since data channel messages have a size limit. `openSocket(url)` returns this for `rtc:` URLs and a plain `WebSocket` otherwise, so the rest of the client does not know the difference.

### Hearing an engine through the page

When `whoami` says `audioToBrowser` (the server's engine plays into a null sink), `engine-output` sends `broadcast {on:true}` and plays the binary frames: `StreamPlayer` decodes them, notices sender drops by sequence gap, tracks jitter and clock drift, and feeds an AudioWorklet sink whose processor is loaded from a Blob URL so a source-only package can ship it. The `AudioContext` is created on the first frame to match the engine's sample rate.

## Tests

```sh
npm test --workspace @studio/engine-browser
npm test --workspace @studio/engine-client
npm test --workspace @studio/engine-protocol
```

They are vitest suites over pure logic: the store, the lease, choice, the probe's relay URLs, pairing, the playhead clock, the stream player, the WebRTC socket (against `@studio/engine-tunnel`'s answerer) and the stream frame codec.
