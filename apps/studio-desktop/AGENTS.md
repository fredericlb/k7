# AGENTS.md — studio-desktop

The DIRECTORY moved out of `engine/` and the npm package is `studio-desktop`; the app the
user installs is still called **`studio-capot`** — `productName`, the executable, the Quit
item, the tooltip. Renaming that is its own change: `docs/lifetime.md` lists what a rename may
and may not touch, and the bundle identifier is frozen regardless.

**st0 in a window, and the engine that window needs** — Electron, TypeScript. It serves st0
itself, from its own http origin, which is what makes the desktop build cost the frontend
almost nothing (`docs/server.md`).

Opening the window starts the supervisor, the engine and the file service; closing it stops all
three. There is no tray and nothing runs on behind it — `docs/lifetime.md` has the teardown
order and what a second device loses. An engine with no window is `studio-engine`, the CLI.

It **embeds** the supervisor: `@studio/engine-host`'s `startSupervisor` runs in this process,
and `supervisorLink.ts` is a third front end over it beside `cli.ts` — not a second
implementation. The supervisor still owns the `<state>` contract, the registry, the engine
and the file service; the app draws what it reports and sends clicks back. It was its own
process driven over NDJSON until `docs/supervisor.md`, which says what that cost and bought.

There is exactly ONE implementation of the contract, and it is `@studio/engine-host`. If you
find yourself about to add a second, that is the thing this arrangement exists to prevent.
It was a Tauri/Rust app until the port; `docs/lifetime.md` keeps the reasoning that survived it.

All source lives under `src/`, all build and lifecycle scripts under `scripts/`.

## The contract

`packages/engine-host/src/hostProtocol.ts` is the definition, and the app **imports it** —
there is no mirror to keep in step, which is the single biggest thing the port bought. It is
no longer serialised; `HostTransport` is now two function calls. Two rules survive that, and
both are load-bearing:

- **Snapshots, not deltas.** A `state` frame is the whole picture, emitted only when its
  serialisation changes — so an idle app costs nothing, and a view that missed one is never
  half-right, only late.
- **The app computes no policy.** Ports, identity, the registry URL, the audio picks and the
  allowlist all arrive in the snapshot. A click goes back as a `cmd`. Sharing an address space
  makes reaching past that seam easy and no more correct: everything still goes through the
  transport, which is what keeps `cli.ts` an equal front end rather than a lesser one.

## Lifetime

```
app (Electron, one window)     ← the process the user kills; creates the Job Object and JOINS it
 ├─ st0-engine                 ← spawned by the supervisor in here; inherits the job
 └─ node file-service.mjs      ← inherits too; its forked grandchild joins as well
```

- **Windows**: `job.init()` then `job.assignSelf()` are the first statements of `whenReady()`,
  before anything spawns. Membership is inherited, so a force-killed app takes the tree with
  it — and since there is no supervisor child left to assign, THIS process has to be the
  member. Forget `assignSelf` and the safety net is silently off.
- **Unix**: killing the app runs its exit path, and the supervisor's `shutdown()` with it.
- **Supervisor crash**: there is no longer such a thing on its own — it shares this process's
  fate, and a throw out of `startSupervisor` is reported through `onHostError` and never
  retried. What used to be a relaunch is now the app restarting.
- **Quit**: `shutdownAndWait` first (the deregister wants to happen while the engine is still
  up), then `pidkill.backstop()` catches anything a hung teardown never got to.

## Key modules

- **`supervisorLink.ts`** — `startSupervisor` in this process, the `HostTransport` that
  carries its frames to the window, and the two things a vendored node used to supply for
  free: the bundle root and a network stack that reads the OS certificate store. See
  `docs/supervisor.md`.
- **`repoRoot.ts`** — where the checkout is, for the dev pidfile and the window icon. What
  survived `hostCmd.ts` when the supervisor stopped being a program to find.
- **`window.ts`** — the one window: a `BaseWindow` holding a strip of tabs above one project
  view each. Closing it quits; `backgroundThrottling` is off on every view, or the playhead
  freezes behind another tab. See `docs/window.md`.
- **`tabs.ts` / `preload.ts`** — the tabs themselves, and the one rule under them: only the tab
  in FRONT holds a project, so switching unloads one and loads the other. The page is told it
  went behind rather than inferring it, and told BEFORE it is hidden. See `docs/tabs.md`.
- **`logbus.ts`** — the truncate is ours; the FORMAT and the writing are re-exported from
  `@studio/engine-host/logbus`, so `HH:MM:SS [tag]` has one definition.
- **`job.ts` / `pidkill.ts`** — the two backstops that stop a supervisor outliving the app.
- **`devPid.ts`** — in dev only, our pid where the restart scripts can find it: unpackaged the
  process image is `electron`, so scanning by name finds nothing.
- **`server/`** — the app's own http origin: st0's dist, the engine registry, a local `/auth`
  that never 401s, and pl8's routes answered locally. `docs/server.md`, `docs/identity.md`,
  `docs/pl8Shim.md`.

**The app spawns no process but the supervisor.** Anything that needs a process started
belongs in `@studio/engine-host`, not here.

## The private CA, and why that is no longer a reason for a child process

This section used to say the supervisor had to be a child of a vendored `node`, because a
registry is routinely fronted by a local proxy with a **private CA** that lives in the OS store
and nowhere else — and without `--use-system-ca` the heartbeat handshake fails *silently*, so
the engine never appears in that UI's picker.

The concern is real and the silence is the worst part of it. The conclusion was wrong: it only
considered `ELECTRON_RUN_AS_NODE`, whose Node version and flag support you genuinely do not
control. Running **in the main process** is a different thing, and a better one — Electron's
`net.fetch` goes through Chromium, which reads the OS store natively. No flag, no vendored Node
version to depend on, and one fewer thing to get wrong than an argv whose ORDER mattered.

So the rule that replaces it: **the heartbeat must never use node's `fetch`.**
`supervisorLink.ts` passes `net.fetch` into `startSupervisor`, and `registryClient.ts` takes it
through `setRegistryFetch` — its default stays node's, because `studio-engine` runs under a real
node with `--use-system-ca` in its `start` script. Two front ends, two correct answers, one
seam. `docs/supervisor.md` has the rest.

## Build / run

`electron@44` declares **no scripts**, so `npm install` never fetches its runtime.
`npm run app:setup` is that step, and both spikes and `start-engine.mjs` check for it.

- `npm run dev` — esbuild watch on `src/`, a Tilt resource. It starts no app; `dev-native.mjs`
  owns the app's lifetime, because a running engine holds `st0-engine` open.
- `npm run build` — the C++ engine, `stageAll` into `staging/`, then electron-builder. The
  staged layout is FLAT and that is load-bearing — see `scripts/docs/buildEngine.md`.
- `npm run app:restart` — stop → build → start, waiting for the merged log to say
  `supervisor up`. It stops **every** instance, whatever build it came from, because
  single-instance is keyed on the identifier and a survivor would silently win.

## Verify

`npm run typecheck` and `npm run test` cover everything a headless machine can. Three things
they cannot, and each has a script or a checklist:

- `npm run app:spike-job` — Windows. Force-kills the app and asserts the grandchild died with
  it. A regression here orphans the engine on 8765/8770 after any crash.
- By hand: **one** app process, with `st0-engine` and the file service as its children —
  there is no supervisor process to look for any more; and the one that matters most, close the
  window and confirm the engine and the file service are both gone.
- By hand, against a registry behind a private CA: the engine appears in its picker. That is
  the whole of what `--use-system-ca` used to buy, and nothing in a green test run covers it.
- By hand, for the tabs: open two on two projects, switch, and confirm the one you left says
  the session is suspended while the one you arrived at reopens by itself — and that the engine
  reports the SECOND project loaded, not both (`docs/tabs.md`).

Every `app:*` script above is this workspace's, not the root's: from the repo root they need
`-w studio-desktop`, and the root answers a bare one with `Missing script`.
