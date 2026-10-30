# Architecture overview

k7 runs as five kinds of process spread over two kinds of machine: the **server**, which hosts
the web origin and every account's files, and an **engine machine**, which makes the sound. A
musician's laptop is usually both a browser and an engine machine; the server also runs an engine
machine of its own.

```text
                        server (one origin)
 ┌───────────────────────────────────────────────────────────────────────┐
 │  k7 backend (apps/k7/backend, Express, port 8789)                     │
 │   ├─ /auth/*        OIDC login, mints the studio.sid session          │
 │   ├─ /api/files/*   file hub ──spawns──> file service (one per account)
 │   ├─ /api/sync      live-sync relay (WebSocket)                       │
 │   ├─ /api/engines   engine registry                                   │
 │   ├─ /api/engine    engine relay (WebSocket)                          │
 │   ├─ /api/engine-tunnel   tunnel hub  <───────────────┐               │
 │   ├─ media library, shares, rehearsal recorder, prefs │               │
 │   └─ the built SPA (apps/k7/frontend/dist)            │               │
 └───────────────────────────────────────────────────────┼───────────────┘
        ▲  HTTPS + WebSocket                             │ supervisor dials out
        │                                                │
 ┌──────┴────────┐                         ┌─────────────┴───────────────┐
 │ browser: k7   │ ── optional WebRTC ───> │ engine machine              │
 │ frontend SPA  │                         │  k7-supervisor ──> k7-runtime│
 └───────────────┘                         └─────────────────────────────┘
```

## The processes

| Process | Code | Runs where | Job |
|---|---|---|---|
| k7 frontend | `apps/k7/frontend` | Browser | The editor, the home page, the media library and rehearsal screens. A React SPA built by Vite. |
| k7 backend | `apps/k7/backend` | Server | One Express process: authentication, preferences, the media library routes, the rehearsal recorder routes, the engine registry and relay, the tunnel hub, the file hub, and the static SPA. |
| file service | `packages/file-service` | Server | One process per account, spawned on demand by the file hub. Every file operation on that account's workspaces, the project compile, and the commands that drive an engine. |
| k7-supervisor | `engine/k7-supervisor` | Engine machine | Starts and watches the engine, lists it at the registry, holds the tunnel back to the server, runs jobs the server asks of the machine. |
| k7-runtime | `engine/k7-runtime` | Engine machine | The C++ audio engine. Receives a compiled project document over WebSocket, plays it, reports transport and meter state. It never reads song files. |

### The k7 backend

`apps/k7/backend/src/server.ts` is the whole entry point. In order, it:

1. layers its `env.yaml` section (`k7-backend`) into `process.env` with `loadServiceEnv`;
2. answers CORS preflights for every origin;
3. calls `setupAuth()` from `@frediverse/oidc` with cookie name `studio.sid`. This backend
   **owns** `/auth/*` for the origin: it mints the session other services only verify. With no
   `OIDC_*` configured it runs a "Dev User" stub;
4. mounts the phone apps' sign-in handoff routes, then the rehearsal recorder (`@studio/rehearsal-server`)
   **before** the media library, whose catch-all `/api` guard would otherwise swallow it;
5. mounts the media library (`apps/k7/backend/src/media/mount.ts`), which in turn mounts the
   engine registry, the tunnel hub, the file hub, shares and stems;
6. mounts per-account preferences at `/api/preferences` and the module builder's AI routes at `/api/ai`;
7. redirects pages on the `play.` and `k7.` host aliases to `/media` and `/rehearsal`;
8. serves `apps/k7/frontend/dist` with hashed assets cached for a year and the shell never cached.

It refuses to start without `STUDIO_FILES_ROOT` (`apps/k7/backend/src/media/fileHub.ts`), because
that folder is the only place workspaces live. On `SIGTERM` it stops the file services and the
rehearsal server, then lets in-flight requests finish within eight seconds.

### File services: one process per account

`packages/file-hub/instances.ts` starts one `@studio/file-service` process per account on first
use (under `tsx`, or a bundled build on the phone) and reaps it when idle. A separate process is
the isolation boundary: the file service keeps one person's state in module globals. The hub
authenticates each request with a signed ticket or the session and forwards only the identity it
verified. The file service listens on loopback only.

The file service drives an engine through `packages/file-service/src/engineLink.ts`. The hub binds
an account's file service to the engine that account **claimed** (`packages/file-hub/binding.ts`),
reaching it through that engine's tunnel; the tunnel hub gives a loopback address bound to the
remote engine, so the file service speaks plain `ws://` and does not know how far away the engine is.

### Engine machines and the tunnel

An engine machine never accepts inbound connections from the server. Its supervisor dials the
backend at `/api/engine-tunnel` (`packages/engine-tunnel/hub.ts` is the server end, the C++
supervisor the machine end, `packages/engine-tunnel/agent.ts` its TypeScript reference), and
everything the server needs from the engine travels as channels over that socket.

A browser reaches an engine in one of two ways:

- **The relay**: a WebSocket to `/api/engine` on the origin, piped through the tunnel
  (`packages/engine-registry/proxy.ts`). This exists because an HTTPS page may not open `ws://`
  to a LAN address.
- **WebRTC**: the offer and answer travel over the tunnel and the supervisor answers with a data
  channel piped to the local engine (`packages/engine-tunnel/rtc.ts`).

The engine registry (`@studio/engine-registry`) lists every engine that heartbeats to the origin.
The browser's single entry to an engine is `@studio/engine-browser/access`.

Where engine machines run:

| Form | Code |
|---|---|
| Command-line engine (`k7-supervisor --config <file>`) | `engine/k7-supervisor`, staged by `engine/scripts/build-engine.mjs` |
| The tray | `apps/k7-tray`: a windowless Tauri app that runs k7's backend on `127.0.0.1:18789`; the backend runs the file services and the supervisor (`@studio/supervisor-host`), and the person opens k7 in their browser |
| Android app | `engine/k7-android`: the engine as a library, the supervisor as a program, and k7's backend bundled |
| Server engine | `engine/docker/Dockerfile`: a container that dials k7 over the compose network and plays into a PulseAudio null sink |

## Data flow for one edit

1. The browser edits a file through `/api/files/*`; the file hub forwards it to the account's file service.
2. Live sync (`@studio/live-sync`) orders the edit as an operation in the workspace's room and relays it
   to the other replicas over `/api/sync`.
3. The file service recompiles the project folder (`@studio/song`) to a `ProjectDoc` and `GraphDoc`.
4. It sends the document to the bound engine over the tunnel, using the wire format in `@studio/engine-protocol`.
5. The engine diffs it against what it is playing and applies the minimal change; transport and
   meter frames come back to the browser through the relay or WebRTC.

The song pipeline, the engine, and the backend each have their own section in this guide with the
details of these steps.

## What runs in production

The hosted origin is the k7 image and the server engine image (see [Images and deployment](./08-images-and-deployment.md)). The tray and the phone apps
carry the same backend, bundled, and run it locally (see
[Releases and publishing](./09-releases-and-publishing.md)).
