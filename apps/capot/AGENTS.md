# AGENTS.md — engine-tray

The **menu-bar / system-tray view** for the engine supervisor — Tauri v2, native Rust,
no window.

It is not itself a supervisor. It spawns **`@studio/engine-host`** (TypeScript) as a
child and drives it over NDJSON on stdio: the supervisor owns the `~/.lanes`
contract and the registry, and — stage by stage — the engine and the file service. The
tray draws what the supervisor reports and sends clicks back.

There is exactly ONE implementation of the contract, and it is the TypeScript one. If
you find yourself about to add a second, that is the thing this arrangement exists to
prevent.

All Rust source lives under `src-tauri/src/`.

## The protocol

`packages/engine-host/src/hostProtocol.ts` is the written definition; `host.rs` is its
hand-written Rust mirror, the same arrangement `engine-protocol` has with the C++
engine. Three rules, all load-bearing:

- **stdout is the protocol.** The supervisor's `ipcStdio.ts` redirects its own stdout to
  stderr at module load, and every child it spawns is piped, never `inherit`. One stray
  line corrupts the frame stream. The tray pumps the supervisor's stderr into the merged
  log like any other child.
- **Snapshots, not deltas.** A `state` frame is the whole picture, emitted only when its
  serialisation changes — so a supervisor that crashed and relaunched resyncs the tray in
  one message, and an idle app is silent on the wire.
- **The tray computes no policy.** Ports, identity, the registry URL, the audio picks and
  the allowlist all arrive in the snapshot. A click goes back up as a `cmd`.

`host.rs`'s `Snapshot` is deliberately PARTIAL: it mirrors only the fields the tray
consumes today. serde ignores the rest, and adding a field is how a later stage takes a
subsystem over.

## Lifetime

```
tray (Tauri, windowless)      ← the process the user kills; creates the Job Object
 └─ node engine-host.mjs      ← job::assign() — the ONLY assign call
     ├─ lanes-engine       ← joins the job automatically (created by a job member)
     └─ node file-service.mjs ← joins; its forked grandchild joins too
```

- **Windows**: `job::init()` runs in `main.rs` setup before anything spawns. Job
  membership is inherited, so a force-killed tray takes the whole tree with it.
- **Unix**: the pipe does the same job. When the tray dies the OS closes the
  supervisor's stdin, `ipcStdio`'s end callback fires, and it tears down.
- **Supervisor crash**: relaunched with 1s→30s backoff; the status line reads
  `⚠ supervisor restarting…`. The engine survives it — the pidfile lets the fresh
  supervisor re-adopt.
- **Quit**: `host::shutdown_and_wait` first (its exit is what deregisters, and that wants
  to happen while the engine is still up), then the tray stops what it still owns, then
  `pidkill::backstop` catches anything a hung supervisor never got to.

## Key modules

- **`host.rs`** — spawn + `job::assign`, the read thread, `send`, the relaunch backoff.
- **`hostcmd.rs`** — where the supervisor lives: `$LANES_ENGINE_HOST_CMD`, else the
  vendored `node` + `engine-host.mjs` from resources, else the repo's tsx on the TS
  source. A miss must be LOUD (`⚠ supervisor not found`) — a tray supervising nothing
  looks identical to a healthy one.
- **`tray.rs`** — the icon and menu. Quit stops the engine **only if THIS app owns it**;
  it won't kill an engine another supervisor started.
- **`supervisor.rs`** — the loops the tray still runs: the spinner and the menu-bar
  appearance re-read (view work that stays), plus crash-watch, the file-service watch and
  the engine query polls (not yet migrated). Rule: snapshot state under the std `Mutex`
  and **drop the guard before any `.await`** — a std mutex must never be held across an
  await point, and never across a blocking call either.
- **`engine.rs` / `fileservice.rs`** — process spawning, until Stage 2 moves it. In dev
  mode `fileservice.rs` does NOT spawn (the file service runs with hot-reload via
  `npm run dev`); in packaged mode it runs the bundled `file-service.mjs`.

## reqwest and trust roots

`reqwest` uses **NATIVE OS trust roots**, not the bundled webpki set. A web UI added from
the tray is routinely fronted by a local proxy with a private CA (Caddy's `tls internal`
for a `.test` host), which lives in the OS store and nowhere else. With webpki-only roots
the heartbeat handshake fails and the engine silently never appears in that UI's picker.

**This is a live constraint on the port, not history.** Node's `fetch` (undici) uses
Node's own bundled Mozilla store, so the supervisor must be launched with
`--use-system-ca` to keep that case working.

## Build / run

Needs the MSVC Rust toolchain on Windows, not `-gnu`.

- `npm run dev` (`tauri dev`) — a debug tray app that carries nothing: no vendored
  engine/node, and an empty `resources` list. The Rust finds the engine in the repo's
  `engine/build/` and the supervisor via `hostcmd.rs`'s dev tier.
- `npm run build` (`tauri build`) — full release bundle. Both run `predev`/`prebuild` =
  `node ../scripts/build-engine.mjs --sidecar-only`, which stages the sidecars **and
  builds both `.mjs` bundles** — Tauri errors on a resource glob matching nothing, so
  even `cargo check` needs them present.

## Verify

`cargo check` under `src-tauri/`. Behavioural check: launch the tray, confirm the engine
registers and appears in a web picker, then quit and confirm the engine stops (only if
the tray owns it). Force-kill the tray and confirm nothing survives — on Windows check
Task Manager for `node.exe`/`lanes-engine.exe` and that 8765/8770 are free. A Windows
build requires the MSVC toolchain — make the edit, explain it, and have the user build.
