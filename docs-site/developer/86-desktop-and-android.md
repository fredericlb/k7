# The tray and the phone apps

The tray (on a computer) and the Android app are the same idea on two platforms: k7's backend, the supervisor and the engine on the user's own device. Both start the **same backend bundle** with the **same settings table**, `apps/k7/backend/standalone.json`:

| Key | Value | Meaning |
|---|---|---|
| `port` | 18789 | The backend's port on every device (not the dev session's 8789, so both can run). Fixed, because a page's storage, its installed app and the sign-in redirect are all keyed on the origin, port included |
| `env` | `OIDC_ISSUER`, `OIDC_CLIENT_ID` (`st0-desktop`, a public client), `STUDIO_LOCAL_USER=1`, `K7_INSTANCE=local`, `STUDIO_LIBRARY_ORIGIN`, `STUDIO_LISTEN_HOST=127.0.0.1`, … | The backend's environment; it listens on loopback only |
| `dirs` | `STUDIO_FILES_ROOT=workspaces`, `STUDIO_MEDIATEK=mediatek`, `STUDIO_PREFS_DIR=prefs/k7`, `STUDIO_HOME=server-home`, `K7_DATA_DIR=k7` | Folders relative to the app's state directory |
| `library` | `k7-core` | The library seeded on first use from the bundled copy (`STUDIO_LIBRARY_SEED`) |

The bundle is built by `apps/k7/backend/scripts/bundle.mjs`, frontend and library included. The page it serves is the same one the hosted origin serves; what differs is asked of the backend (`GET /api/local`, `apps/k7/frontend/docs/localApp.md`).

## `@studio/supervisor-host`

`packages/supervisor-host/` runs `engine/k7-supervisor` as a child process of a node program: k7's backend under the tray (`apps/k7/backend/src/localEngine/host.ts`). Its `stageEngine` also serves the tray's staging and `engine/scripts/build-engine.mjs`.

| Export | File | What |
|---|---|---|
| `./supervisorHost` | `packages/supervisor-host/src/supervisorHost.ts` | `SupervisorHost({bin, env, enginePidFile, log, onSnapshot, onNotify, onDown, backoff})`: spawns the supervisor with no arguments, keeps stdin open for the host's whole life (its closing is the supervisor's quit), parses NDJSON frames, and relaunches a dead supervisor on a 1 s → 30 s backoff, reset after 20 s of uptime. `send(cmd, arg)` writes a command. `stop()` closes stdin, waits, and kills an engine that outlived the teardown using `enginePidFile`. |
| `./hostProtocol` | `packages/supervisor-host/src/hostProtocol.ts` | The mirror of `HostProtocol.h`, partial on purpose: a field is added when a host first reads it. Read snapshots through `snapshotOf`, since a frame may omit an empty list. |
| `./stageEngine` | `packages/supervisor-host/scripts/stageEngine.mjs` | `stageEngine({repo, bin})`: copy the newest engine and supervisor builds (Debug last) into a staging `bin/`, with the ONNX Runtime libraries beside the supervisor and the Faust `.lib` files into `faust-libs/` (found through the engine's `CMakeCache.txt`). `$STUDIO_PREBUILT_BIN` copies an already staged `bin/` instead, which is how CI packages binaries built by another job. |

The test (`packages/supervisor-host/src/supervisorHost.test.ts`) drives a fake supervisor, a node script speaking the same NDJSON.

## The tray (`apps/k7-tray`, Tauri)

A windowless Tauri app (Rust, no webview) in the menu bar or system tray. It starts one process, a bundled and pinned Node 24 running k7's backend bundle on `http://127.0.0.1:18789`, and opens that address in the person's own browser, where k7 installs as an app. The backend runs the supervisor over stdio on `~/.k7` and the supervisor's own port (8765): the tray's engine is the machine's engine, the one the command-line engine would be. Everything is on the machine, so it works offline. The choices and their reasons are in `apps/k7-tray/docs/tray.md`; the backend's side in `apps/k7/backend/docs/localEngine.md`.

| Where | What |
|---|---|
| `apps/k7-tray/src-tauri/src/backend.rs` | The one spawn, its environment (standalone.json's, plus `K7_SUPERVISOR_BIN`, the tray's bearer `K7_TRAY_TOKEN`, the release stamp), readiness, the backoff, the stop (closing stdin, `K7_STDIN_STOP`) |
| `apps/k7-tray/src-tauri/src/loops.rs`, `tray.rs` | The status line, read from `/api/local/tray` under the bearer and drawn as worded (`apps/k7/backend/src/localEngine/trayStatus.ts`) |
| `apps/k7-tray/src-tauri/src/updates.rs` | tauri-plugin-updater on the tray's channel feed (`docs/app-downloads.md`) |
| `apps/k7-tray/src-tauri/src/job.rs`, `pidkill.rs` | The safety nets: a Windows job object, so a force-killed tray takes its tree with it, and a backstop for an engine a hung supervisor left |
| `apps/k7/backend/src/localEngine/` | The supervisor host and the routes a page reaches it through: `/api/local/engine` (the snapshot as Server-Sent Events, an allow-list of commands), `/api/local/tray`, and `/api/local`, the probe that tells a page it is on a machine's own backend |
| `apps/k7/frontend/src/settings/desktopEngine.ts` | The engine settings page (`/settings/engine`) over those routes |

Sign-in is the backend's own `/auth/login` in the browser, and a signed-out page becomes the local user (`/auth/local`); pairing with a server's sync relay starts from a click in the account bar (`apps/k7/frontend/src/tabs/browserAccount.ts`).

### Running and packaging

```sh
npm run stage --workspace k7-tray    # frontend, backend bundle, engine binaries, pinned node into src-tauri/resources/
npm run dev --workspace k7-tray      # tauri dev
npm run build --workspace k7-tray    # the installers
```

`apps/k7-tray/scripts/stage.mjs` builds the resources: the backend bundle, `bin/` from `stageEngine`, and node. The bundle identifier `org.parapluie.studio.engine-tray` must not change: macOS keys the microphone grant and the login item on it. The engine and supervisor must have been built first ([87](./87-engine-build-and-shipping.md)). `cargo test` in `apps/k7-tray/src-tauri` and `npx vitest run src/localEngine` in `apps/k7/backend` are the unit tests; `apps/k7-tray/AGENTS.md` gives the behavioural check.

## `engine/k7-android`

A Kotlin app on Capacitor, `arm64-v8a` only, Android 10 (API 29) and up.

### Native parts

Android only lets an app execute files from its native library directory, so both native programs ship as `lib*.so`:

| Shipped as | Built from | How it runs |
|---|---|---|
| `libk7runtime.so` | `engine/k7-runtime`, preset `android-arm64`: a **shared library** with `engine/k7-runtime/server/android/EngineJni.cpp` and no `main()` | Loaded in the app's process. `EngineBridge.kt` sets the environment, initialises JUCE, and calls `nativeServe(port)` on a thread that prepared a `Looper`, which becomes JUCE's message thread. Once per process: a stopped engine needs a new process. |
| `libk7supervisor.so` | `engine/k7-supervisor`, preset `android-arm64`, an executable renamed | Spawned by `SupervisorHost.kt` with `STUDIO_HOME`, `STUDIO_MACHINE_NAME` (the device name), `STUDIO_INSTRUMENTS=all`, `STUDIO_PORTS` and `STUDIO_EXTRA_CA_CERTS`. Its `engine` frames start and stop the in-process engine. |
| Termux's `node` and its libraries | `engine/k7-android/scripts/termux-tools.mjs`, every `.deb` pinned by SHA-256 in `engine/k7-android/scripts/termux-packages.json` | Runs k7's backend bundle (`BackendHost.kt`), patched in place for its new prefix |

The engine's Android build has no VST3/LADSPA hosting and no Surge XT, and grows its buffer on underruns (up to 40 ms).

### Kotlin

`engine/k7-android/app/src/main/kotlin/se/frediver/k7/`:

| File | Role |
|---|---|
| `MainActivity.kt` | A Capacitor `BridgeActivity`: registers the two plugins, keeps the screen on, starts the backend, asks for `RECORD_AUDIO` then starts the supervisor. Finishing the activity stops supervisor, engine and backend and exits the process. |
| `BackendHost.kt` | Unpacks `backend.zip` and the Termux tools, then runs k7's backend on `127.0.0.1:18789` |
| `SupervisorHost.kt` | The NDJSON channel (what `supervisorHost.ts` is to the tray's backend); pins the local backend first in `registryUrls` |
| `EngineBridge.kt`, `EngineOps.kt` | The in-process engine; LAN address, CA import and forget (which restart the supervisor, which then adopts the running engine) |
| `EnginePlugin.kt` | Capacitor plugin `K7Runtime` for the tray page: `state` and `engineExit` events, commands, quit |
| `AppViewsPlugin.kt` | Each studio app (k7, the media library, the rehearsal recorder) in a full-screen WebView of its own, loaded from the connected studio, created once and then only hidden so it keeps its state |
| `StudioBridge.kt` | `window.k7Android` for those views: status bar colour, account, media session for everyone; the engine (k7's settings panel, `apps/k7/frontend/src/settings/androidEngine.ts`) for k7's origin only, checked per message |
| `AuthHandoff.kt`, `SyncPairing.kt` | Sign-in and sync pairing through the system browser (`apps/k7/backend/docs/handoff.md`) |
| `MediaPlayback.kt`, `MediaPlaybackService.kt` | A media notification, and the one foreground service, held only while a page plays |
| `TrustedCas.kt` | User-picked CA certificates |

### The tray page

`engine/k7-android/web/` is a small React app built with Vite and staged as Capacitor's `public/`. `App.tsx` chooses the studio (`studios.ts`: the phone's own first, then the supervisor's list, remembering the last pick) and asks `AppViews` to show k7 over it; `Tray.tsx` and `Pairing.tsx` draw the engine status, studios, pairing and CA controls when no studio is shown.

### Building

```sh
cd engine/k7-android
./gradlew assembleDebug
```

`engine/k7-android/app/build.gradle.kts` wires `preBuild` to: `buildEngine` (`node scripts/build.mjs android-arm64` in `engine/k7-runtime`, with the SDK's NDK), `buildSupervisor` (`engine/scripts/supervisorBuild.mjs` with `STUDIO_SUPERVISOR_PRESET=android-arm64`), `stageEngine`, `stageFaustLibs` (into assets), `stageShell` (the tray page), `stageTermuxTools`, and `stageBackend` (`buildFrontend` then `bundle.mjs`, zipped with `standalone.json`, stored uncompressed). This compiles the whole C++ engine for Android; it is a long build.
