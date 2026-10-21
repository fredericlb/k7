# AGENTS.md — the tray

**k7 on a computer.** A windowless Tauri app in the menu bar / system tray. It starts one process, node running
k7's backend bundle on `127.0.0.1:<standalone.json port>`. The backend runs the machine's supervisor
(`engine/k7-supervisor`) and so its engine. The person uses k7 in their browser, at that address, as an
installable web app. The tray shows one status line and opens k7.

It has no webview and no settings of its own: every setting of the engine is a page of k7
(`/settings/engine`), which reaches the supervisor through the backend (`apps/k7/backend/docs/localEngine.md`).

All Rust lives under `src-tauri/src/`. `docs/tray.md` says what was decided and why.

## Lifetime

```
tray (Tauri, windowless)        ← the process the user kills; creates the Job Object
 └─ node: k7's backend          ← job::assign — the ONLY spawn; stdin closing is its stop
     ├─ file services (node)
     └─ k7-supervisor           ← run by the backend over stdio (localEngine/host.ts)
         └─ k7-runtime
```

- **Windows**: `job::init()` runs before anything spawns; membership is inherited, so a force-killed tray takes
  the whole tree with it.
- **Unix**: the pipes do it. The tray's death closes the backend's stdin (`K7_STDIN_STOP`), whose stop stops the
  supervisor, whose closing stdin stops the engine.
- **Backend crash**: relaunched with 2 s→60 s backoff; six quick deaths in a row and the status line says so.
- **Quit**: `backend::stop` closes stdin and waits 15 s (the supervisor deregisters first), then `pidkill::backstop`.

## Key modules

- **`backend.rs`** — the spawn, its environment (standalone.json's, plus the supervisor, the bearer, the stamp),
  readiness on `/api/registry/hello`, the backoff, the stop.
- **`loops.rs`** — the status poll (`/api/local/tray`, under the bearer), the spinner, the menu-bar appearance.
- **`tray.rs`** — the menu. Draws what the backend words; computes nothing.
- **`paths.rs`** — node, the bundle, the supervisor: the staged resources, else the checkout's builds. A miss
  is said on the status line, never a silent empty tray.
- **`updates.rs`** — tauri-plugin-updater on the tray's channel feed (`docs/tray.md`).
- **`job.rs`**, **`pidkill.rs`**, **`logbus.rs`**, **`trayicon.rs`** — the safety nets, the merged log, the icon.

## Build / run

Builds belong to Windows, never to WSL (root `AGENTS.md`). `dev` is the dev session's `k7-tray` resource
(`scripts/dev-tray.mjs`, `docs/dev.md`); the installers are `tray:build`, never `build`, which the root `npm run build`
would run.

- `npm run stage --workspace k7-tray` — the frontend and the backend bundle, the engine (the repo's builds, or
  `$STUDIO_PREBUILT_BIN`), a pinned node, into `src-tauri/resources/`.
- `npm run dev` (Tilt) or `npm run dev:tray` (alone) — builds the engine, the supervisor, k7's backend bundle and
  the tray, runs the tray on them, and rebuilds and restarts on save. `cargo build` in `src-tauri` alone is enough
  to run `target/debug/k7-tray.exe` on staged resources.
- `npm run tray:build --workspace k7-tray` — the installers; `node engine/scripts/package-release.mjs --kind tray`
  renames them for a release.

## Verify

`cargo test` in `src-tauri`; the backend's side is `npx vitest run src/localEngine` in `apps/k7/backend`.
Behavioural check: start the tray, open k7 from its menu, open a project and play it; then quit and confirm the
engine stops. Force-kill the tray and confirm nothing survives: no `node.exe`, `k7-supervisor.exe` or
`k7-runtime.exe` of its tree, and the k7 port and the engine's free.
