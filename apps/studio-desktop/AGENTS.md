# AGENTS.md — studio-desktop

The DIRECTORY moved out of `engine/` and the npm package is `studio-desktop`; the app the
user installs is still called **`studio-capot`** — `productName`, the executable, the Quit
item, the tooltip. Renaming that is its own change: `docs/tray.md` lists what a rename may
and may not touch, and the bundle identifier is frozen regardless.

The **menu-bar view** over the engine supervisor, and the window st0 opens in — Electron,
TypeScript. It serves st0 itself, from its own http origin, which is what makes the desktop
build cost the frontend almost nothing (`docs/server.md`).

It is not itself a supervisor. It spawns **`@studio/engine-host`** as a child and drives it
over NDJSON on stdio: the supervisor owns the `~/.studio` contract, the registry, the engine
and the file service. The app draws what the supervisor reports and sends clicks back.

There is exactly ONE implementation of the contract, and it is `@studio/engine-host`. If you
find yourself about to add a second, that is the thing this arrangement exists to prevent.
It was a Tauri/Rust app until the port; `docs/tray.md` keeps the reasoning that survived it.

All source lives under `src/`, all build and lifecycle scripts under `scripts/`.

## The protocol

`packages/engine-host/src/hostProtocol.ts` is the definition, and the app **imports it** —
there is no mirror to keep in step, which is the single biggest thing the port bought. Three
rules, all load-bearing:

- **stdout is the protocol.** The supervisor's `ipcStdio.ts` redirects its own stdout to
  stderr at module load, and every child it spawns is piped, never `inherit`. One stray line
  corrupts the frame stream. The app pumps the supervisor's stderr into the merged log.
- **Snapshots, not deltas.** A `state` frame is the whole picture, emitted only when its
  serialisation changes — so a supervisor that crashed and relaunched resyncs in one message,
  and an idle app is silent on the wire.
- **The app computes no policy.** Ports, identity, the registry URL, the audio picks and the
  allowlist all arrive in the snapshot. A click goes back up as a `cmd`.

## Lifetime

```
app (Electron, windowless)     ← the process the user kills; creates the Job Object
 └─ node engine-host.mjs       ← job.assign() — the ONLY assign call
     ├─ studio-moteur          ← joins the job automatically (created by a job member)
     └─ node file-service.mjs  ← joins; its forked grandchild joins too
```

- **Windows**: `job.init()` is the first statement of `whenReady()`, before anything spawns.
  Job membership is inherited, so a force-killed app takes the whole tree with it.
- **Unix**: the pipe does the same. When the app dies the OS closes the supervisor's stdin,
  `ipcStdio`'s end callback fires, and it tears down.
- **Supervisor crash**: relaunched with 1s→30s backoff; the status line reads
  `⚠ supervisor restarting…`. The engine survives it — the pidfile lets the fresh supervisor
  re-adopt.
- **Quit**: `shutdownAndWait` first (its exit is what deregisters, and that wants to happen
  while the engine is still up), then `pidkill.backstop()` catches anything a hung supervisor
  never got to.

## Key modules

- **`host.ts`** — spawn + `job.assign`, the NDJSON read loop, `send`, the relaunch backoff.
  Takes its command already resolved, so a fake supervisor makes it testable.
- **`hostCmd.ts`** — where the supervisor lives: `$STUDIO_ENGINE_HOST_CMD`, else the vendored
  `node` + `engine-host.mjs` from resources, else the repo's tsx on the TS source. A miss must
  be LOUD (`⚠ supervisor not found`) — an app supervising nothing looks identical to a healthy
  one. Takes `Packaging` rather than importing `electron`, so the `--use-system-ca` argv is
  testable.
- **`menu.ts`** — the whole menu as a template. Its electron import is TYPE-ONLY and erased at
  build, which is what makes every label and enable rule testable without a browser process.
- **`tray.ts`** — the template applied to a real `Tray`, rebuilt only when what it SHOWS
  changed. The menu is four rows now: every control is at `/@settings` in st0, and the icon
  keeps only presence and the way back to a window. See `docs/settings.md`.
- **`route.ts`** — one menu id to one act. The two encodings that fail quietly live here:
  `SHOW_UI_SEP` in a plugin row, and `fb:` as a meaningful empty arg.
- **`iconRaster.ts` / `trayIcon.ts`** — the icon drawn in code rather than loaded from PNGs,
  and cached as `NativeImage`s. See `docs/trayIcon.md`.
- **`logbus.ts`** — the truncate is ours; the FORMAT and the writing are re-exported from
  `@studio/engine-host/logbus`, so `HH:MM:SS [tag]` has one definition.
- **`job.ts` / `pidkill.ts`** — the two backstops that stop a supervisor outliving the app.
- **`devPid.ts`** — in dev only, our pid where the restart scripts can find it: unpackaged the
  process image is `electron`, so scanning by name finds nothing.
- **`window.ts`** — st0's window. Closing HIDES, `backgroundThrottling` is off, and the Dock
  icon follows the window rather than the app. See `docs/window.md`.
- **`server/`** — the app's own http origin: st0's dist, the engine registry, a local `/auth`
  that never 401s, and pl8's routes answered locally. `docs/server.md`, `docs/identity.md`,
  `docs/pl8Shim.md`.

**The app spawns no process but the supervisor.** Anything that needs a process started
belongs in `@studio/engine-host`, not here.

## `--use-system-ca`, and why the supervisor is a child

The supervisor is launched as a child of a **vendored `node`**, not run inside Electron, and
the flag is the reason. A web UI added from this app is routinely fronted by a local proxy
with a private CA, which lives in the OS store and nowhere else; without `--use-system-ca` the
heartbeat handshake fails **silently** and the engine never appears in that UI's picker.

That flag belongs to a Node version we ship. Do not move the supervisor under
`ELECTRON_RUN_AS_NODE`, whose Node version and flag support you do not control.

## Build / run

`electron@44` declares **no scripts**, so `npm install` never fetches its runtime.
`npm run app:setup` is that step, and both spikes and `start-engine.mjs` check for it.

- `npm run dev` — esbuild watch on `src/`, a Tilt resource. It starts no app; `dev-native.mjs`
  owns the app's lifetime, because a running engine holds `studio-moteur` open.
- `npm run build` — the C++ engine, `stageAll` into `staging/`, then electron-builder. The
  staged layout is FLAT and that is load-bearing — see `scripts/docs/buildEngine.md`.
- `npm run tray:restart` — stop → build → start, waiting for the merged log to say
  `supervisor up`. It stops **every** instance, whatever build it came from, because
  single-instance is keyed on the identifier and a survivor would silently win.

## Verify

`npm run typecheck` and `npm run test` cover everything a headless machine can. Three things
they cannot, and each has a script or a checklist:

- `npm run app:spike-job` — Windows. Force-kills the app and asserts the grandchild died with
  it. A regression here orphans the engine on 8765/8770 after any crash.
- `npm run app:spike-menu` — all platforms, needs your eyes. Whether mutating `MenuItem.label`
  shows up in a live menu, which the spinner depends on.
- By hand: one icon **and one process**; no Dock icon on macOS; `ps -o args=` on the supervisor
  showing `--use-system-ca` FIRST; quit and confirm the engine stops (only if we own it).
