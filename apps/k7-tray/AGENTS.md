# AGENTS.md — the tray

The **menu-bar / system-tray view** for the engine supervisor — Electron, on
`@frediverse/electron-shell` and `@studio/supervisor-host`. It starts with no window and opens exactly one on demand: the settings
window, in seven tabs — the audio ranking dragged into order, the plugin catalogue, the sessions
this engine holds, the k7 instances this engine is connected to, the instruments it downloads,
the paired devices, and the machine itself. The menu bar keeps one status line and the way in.

It is not itself a supervisor. It spawns **`k7-supervisor`** (engine/k7-supervisor, native) as a
child and drives it over NDJSON on stdio: the supervisor owns the `~/.k7` contract, the registry
and the engine. There is no file service on this machine: workspaces live on the server, and the
supervisor runs the jobs the server hands it over the tunnel. The tray draws what the supervisor
reports and sends clicks back.

There is exactly ONE implementation of the contract, and it is the supervisor's. If you find
yourself about to add a second, that is the thing this arrangement exists to prevent.

It ships on its own: `.github/workflows/tray.yml` builds it for the three desktops, publishes it
as GitHub releases of its own and on `k7.rocks/app_downloads/tray`, and the installed tray updates
itself from there exactly as the desktop app does (`@studio/app-updates`). The native pieces are
built by `engine/scripts`, not here (`engine/scripts/docs/buildEngine.md`).

## The protocol

`engine/k7-supervisor/src/HostProtocol.h` is the written definition;
`packages/supervisor-host/src/hostProtocol.ts` is its mirror, typed from
`packages/supervisor-host/schema/hostProtocol.schema.json`. Three rules, all load-bearing:

- **stdout is the protocol.** Only the supervisor's `protocol::emit` writes there. The tray files
  the supervisor's stderr in the merged log.
- **Snapshots, not deltas.** A `state` frame is the whole picture, emitted only when its
  serialisation changes — so a supervisor that crashed and relaunched resyncs the tray in one
  message, and an idle app is silent on the wire.
- **The tray computes no policy.** Ports, identity, the registry URL and the audio picks all
  arrive in the snapshot. A click goes back up as a `cmd`.

A frame's missing lists are filled by `snapshotOf`; the tray reads a snapshot, never a raw frame.

## Lifetime

```
tray (Electron, windowless)   ← the process the user kills
 └─ k7-supervisor            ← spawned `detached` on Windows; makes the job and hands the tray its only handle
     └─ k7-runtime            ← born inside that job
```

- **Windows**: the kill-on-close job is the supervisor's, held by the tray alone
  (`engine/k7-supervisor/docs/hostProtocol.md`), so a force-killed tray takes the stack with it.
- **Unix**: the pipe does the same job. When the tray dies the OS closes the supervisor's stdin,
  its reader ends, and it tears down.
- **Supervisor crash**: relaunched with 1s→30s backoff; the status line reads
  `⚠ supervisor restarting…`. The engine survives it — the pidfile lets the fresh supervisor
  re-adopt.
- **Quit**: `shutdown` first (its exit is what deregisters, and that wants the engine still up),
  then the engine named by the pidfile is killed, tree and all, if it outlived the teardown.

## Key modules

- **`src/main.ts`** — the tray, its menu, the commands the settings page sends, quit.
- **`@studio/supervisor-host/supervisorHost`** — spawn, the relaunch backoff, `send`, the stop and
  its backstop; shared with `apps/k7-standalone`.
- **`src/paths.ts`** — where the supervisor lives: `$STUDIO_ENGINE_HOST_CMD`, else the copy in the
  app's `Resources/bin`, else the repo's newest build. A miss must be LOUD (`⚠ supervisor not
  found`) — a tray supervising nothing looks identical to a healthy one.
- **`src/status.ts`** / **`src/view.ts`** — what the menu bar and the settings page draw, as plain
  functions of the snapshot. Tested.
- **`src/settingsWindow.ts`** + **`src/preload.ts`** — the one window over `settings/`, and its
  `window.k7Tray` bridge. Closing HIDES it.
- **`src/trayIcon.ts`** — the icon drawn in code: four states, one animated. See `docs/trayIcon.md`.
- **`src/mergedLog.ts`** — the tray's end of `<state>/.studio.log`: truncated once per session,
  `[host]` lines in the supervisor's format.
- **`src/updates.ts`** — `@studio/app-updates` on the tray's feed: the menu's two update entries
  and the automatic check (`packages/app-updates/docs/appUpdates.md`).

**The tray spawns no process** but the supervisor — and the installer electron-updater runs at
quit, which is the update's, not the tray's. Anything else that needs a process started belongs
there, not here.

## Build / run

- `npm start` — bundle the main process and run Electron on this checkout, in the foreground. It
  finds the supervisor in `engine/k7-supervisor/build/`, which finds the engine in
  `engine/k7-runtime/build/`.
- `npm run tray:restart` — stop every tray and engine → bundle → start detached → wait for the
  merged log to say `supervisor up`, exit non-zero if it didn't. The loop to use when nobody is
  watching a terminal. See `scripts/docs/restartTray.md`.
- `npm run package` — the installer for this platform into `out/`, from what is already built.
  The root's `npm run engine:build` builds the native pieces first (`engine/scripts/docs/buildEngine.md`);
  `node engine/scripts/package-release.mjs --kind tray` renames the installer for a release.

Builds and dev servers on the Windows machine follow the root `AGENTS.md`: nothing is built in WSL.

## Verify

`npm test` and `npx tsc --noEmit` here. Behavioural check: launch the tray, confirm the engine
registers and appears in a web picker, then quit and confirm the engine stops. Force-kill the tray
and confirm nothing survives — on Windows check Task Manager for
`k7-supervisor.exe`/`k7-runtime.exe` and that 8765 is free.
