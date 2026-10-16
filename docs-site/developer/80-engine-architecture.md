# Engine architecture

This section covers everything that links a k7 page to sound: the C++ engine, its supervisor, the wire between them and the browsers, the registry that lists engines, the tunnel that reaches them, and the three hosts that ship them (the desktop app, the phone, the server image). This page is the map; the following pages go into each part.

| Page | Covers |
|---|---|
| [81 — The C++ engine](./81-k7-runtime.md) | `engine/k7-runtime`: layout, CLI modes, the server, the diff, sessions, hosted plugins, the Strudel bundle, tests |
| [82 — The supervisor](./82-k7-supervisor.md) | `engine/k7-supervisor`: run modes, the host protocol, settings, registry, tunnel agent, machine jobs |
| [83 — The engine protocol](./83-engine-protocol.md) | `packages/engine-protocol` and the C++ handlers: every message, the state frame, the ProjectDoc, sessions, the audio stream |
| [84 — Engine clients](./84-engine-clients.md) | `packages/engine-client` (Node) and `packages/engine-browser` (browser): access, probe, choice, lease, store, pairing, WebRTC |
| [85 — Registry and tunnel](./85-registry-and-tunnel.md) | `packages/engine-registry` and `packages/engine-tunnel`: heartbeats, claims, the relay, the hub and agent, jobs |
| [86 — Desktop and Android hosts](./86-desktop-and-android.md) | `packages/supervisor-host`, `apps/k7-standalone`, `engine/k7-android` |
| [87 — Building and shipping engines](./87-engine-build-and-shipping.md) | `engine/scripts`, CMake presets, release archives, `engine/docker` |

## The processes

```text
 browser (k7 page)                       k7 server (apps/k7/backend)
 ├─ @studio/engine-browser  ── HTTPS ──► ├─ engine registry  (/api/registry/*, /api/engines, /api/engine/*)
 │      │                                ├─ engine relay     (/api/engine/<id>/ws)
 │      │                                ├─ tunnel hub       (/api/engine-tunnel)
 │      │                                └─ file hub → file service per account (@studio/engine-client)
 │      │                                          ▲
 │      │   ws / wss / WebRTC                       │ one outbound WebSocket per studio (the tunnel)
 │      ▼                                          │
 engine machine ─────────────────────────────────────────────────────────────
 ├─ k7-supervisor   (C++) — starts/adopts/watches the engine, heartbeats, tunnel agent, jobs, WebRTC answerer
 └─ k7-runtime      (C++) — WebSocket server on :8765, Tracktion Edit per session, audio device
```

Two choices shape all of it.

**The engine never parses song files.** The file service compiles a project folder into a `ProjectDoc` (JSON) and sends that. The engine diffs it against what it is playing and changes only what moved. Any app that can build a `ProjectDoc` can drive the engine: k7's editor, the DJ desk, a share player, a one-track module preview. This keeps YAML, schemas and the compiler in TypeScript and keeps the C++ side a player.

**The machine dials out.** An engine machine is usually behind a home router. Rather than ask the musician to open a port, the supervisor holds one outbound WebSocket to every studio it is listed at, and the studio routes everything it needs through it: the relayed browser socket, the project files, machine jobs, and the WebRTC offer that lets a browser connect peer to peer.

## How a browser reaches an engine

`@studio/engine-browser`'s probe races every candidate address and keeps the fastest that answers `whoami` with the expected id:

| Candidate | URL | Offered when |
|---|---|---|
| Loopback | `ws://127.0.0.1:<port>` | always |
| LAN | `ws://<lanIp>:<port>` | the page is `http:` (an `https:` page may not open `ws://` to a LAN host: mixed content) |
| Relay | `wss://<studio>/api/engine/<id>/ws?ticket=…` | the registry minted a relay ticket (always, per listing) |
| WebRTC | `rtc:<studio>/api/engine/<id>/rtc` | the engine has a tunnel up |

The relay dials the engine through its tunnel first, then the address its heartbeat came **from** (never an address the heartbeat names, since the heartbeat route is open). A relay ticket is bound to one engine and one account; behind it a `RelayGate` lets an account with no claim on the engine send only the probe verbs (`whoami`, `pair`, `list-plugins`) and closes the socket if no claim arrives within ten seconds. WebRTC uses no STUN or TURN servers on either side (`iceServers: []`), so it connects only with host candidates, which in practice means the same network. It exists so an `https:` page can reach a LAN engine directly without the relay.

Over a direct LAN connection, the engine requires pairing ([83](./83-engine-protocol.md#pairing)); loopback peers and relayed traffic (which arrives from the supervisor on loopback, already authenticated by the server) are trusted. Independently of the peer address, a **browser page** is only served when its `Origin` is allowed: loopback, `https://st0.app` and its subdomains, or a studio the supervisor is listed at.

## Trust

Anyone may run an engine and heartbeat it to an open registry, so trust is layered:

| Layer | Rule | Code |
|---|---|---|
| Identity | `engine-id.json` holds an id, a token (handed to the engine, echoed on `whoami`, readable by browsers) and a **tunnel secret** the supervisor alone sends. The registry binds an id to the first secret it sees, on disk; the token alone never takes a bound id back. | `engine/k7-supervisor/src/Identity.cpp`, `packages/engine-registry/bindings.ts` |
| Registry admission | At most 1000 engines listed, 30 new ids per source address per minute | `packages/engine-registry/registry.ts` |
| Browser page | Origin allow-list | `engine/k7-runtime/server/Pairing.cpp` (`originAllowed`) |
| LAN device | Pairing | `engine/k7-runtime/server/ServePairing.cpp` |
| Relay | Ticket bound to account; claim required beyond probing | `packages/engine-registry/proxy.ts`, `packages/engine-registry/relayGate.ts` |
| Auto-pick | Only the account's remembered engine, one reached directly, or the server's own engine is taken without a click | `packages/engine-browser/src/choose.ts` (`mayAutoPick`) |

## Where a project's audio files come from

The account's files live on the server. When a project opens on an engine, the file service opens an engine channel through the hub with **roots**: server directories shared with the channel. The agent's `PathMap` rewrites every JSON string under a root to a path in its local cache (`<state>/remote/<server>/…`) and **downloads the file before forwarding the frame that names it**. Files the engine writes (a take) are uploaded before the frame naming them reaches the server. A channel the server has already synced is only rewritten. See [85](./85-registry-and-tunnel.md#path-rewriting).

## Where the code lives

| Path | What |
|---|---|
| `engine/k7-runtime/` | The engine (C++20, JUCE via Tracktion Engine, IXWebSocket) |
| `engine/k7-supervisor/` | The supervisor (C++20, IXWebSocket + mbedTLS, libdatachannel, ONNX Runtime, miniz) |
| `engine/k7-android/` | The Android app (Kotlin, Capacitor) |
| `engine/scripts/` | Build and packaging scripts for the engine and supervisor |
| `engine/docker/` | The server engine's image |
| `packages/engine-protocol/` | Wire types, ProjectDoc types, sessions, the binary audio frame |
| `packages/engine-client/` | The Node client and `~/.k7` path helpers |
| `packages/engine-browser/` | The browser client, React stores, access/probe/choose/lease, pairing, WebRTC socket, audio stream player |
| `packages/engine-registry/` | The registry, its routes, the relay |
| `packages/engine-tunnel/` | The tunnel hub, the TypeScript reference agent, jobs client, WebRTC answerer |
| `packages/supervisor-host/` | Running the supervisor as an Electron app's child |
| `apps/k7-standalone/` | The desktop app |

## Two implementations, one wire

Several contracts have a C++ side and a TypeScript side kept equal by hand:

| Contract | C++ | TypeScript |
|---|---|---|
| ProjectDoc | `engine/k7-runtime/engine/ProjectDoc.h`, `engine/k7-runtime/server/DocJson.cpp` | `packages/engine-protocol/project.ts` |
| Host protocol (supervisor ↔ app) | `engine/k7-supervisor/src/HostProtocol.h` | `packages/supervisor-host/src/hostProtocol.ts`, the Kotlin in `engine/k7-android` |
| `~/.k7` layout | `engine/k7-supervisor/src/Paths.cpp` | `packages/engine-client/src/paths.ts` |
| URL rules (registry, family, cache key) | `engine/k7-supervisor/src/Url.cpp` | `packages/web-protocol/services.ts` |
| Tunnel agent | `engine/k7-supervisor/src/TunnelAgent.cpp` | `packages/engine-tunnel/agent.ts` |
| WebRTC fragments | `engine/k7-supervisor/src/RtcFrames.cpp` | `packages/web-protocol/rtcFrames.ts` |
| Performance score | `engine/k7-supervisor/src/Performance.cpp` | `packages/web-protocol/performance.ts` |

TypeScript cannot check a wire change against C++. When you change one side, change the other in the same commit and verify by running the engine. The tunnel is the exception that has a shared test: `packages/engine-tunnel` runs its suites against both agents (see [85](./85-registry-and-tunnel.md#tests)).
