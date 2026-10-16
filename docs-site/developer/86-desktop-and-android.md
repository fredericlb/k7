# Desktop and Android hosts

The desktop app and the Android app are the same idea on two platforms: k7's backend, the supervisor and the engine on the user's own device, with k7's pages in a window. Both start the **same backend bundle** with the **same settings table**, `apps/k7/backend/standalone.json`:

| Key | Value | Meaning |
|---|---|---|
| `port` | 18789 | The backend's port (not the dev session's 8789, so both can run) |
| `env` | `OIDC_ISSUER`, `OIDC_CLIENT_ID` (`st0-desktop`, a public client), `STUDIO_LOCAL_USER=1`, `K7_INSTANCE=local`, `STUDIO_LIBRARY_ORIGIN`, `STUDIO_LISTEN_HOST=127.0.0.1`, … | The backend's environment; it listens on loopback only |
| `dirs` | `STUDIO_FILES_ROOT=workspaces`, `STUDIO_MEDIATEK=mediatek`, `STUDIO_PREFS_DIR=prefs/k7`, `STUDIO_HOME=server-home`, `K7_DATA_DIR=k7` | Folders relative to the app's state directory |
| `library` | `k7-core` | The library seeded on first use from the bundled copy (`STUDIO_LIBRARY_SEED`) |

The bundle is built by `apps/k7/backend/scripts/bundle.mjs`, frontend and library included.

## `@studio/supervisor-host`

`packages/supervisor-host/` runs `engine/k7-supervisor` as the child of an Electron app.

| Export | File | What |
|---|---|---|
| `./supervisorHost` | `packages/supervisor-host/src/supervisorHost.ts` | `SupervisorHost({bin, env, enginePidFile, log, onSnapshot, onNotify, onDown, backoff})`: spawns the supervisor with no arguments, keeps stdin open for the host's whole life (its closing is the supervisor's quit), parses NDJSON frames, and relaunches a dead supervisor on a 1 s → 30 s backoff, reset after 20 s of uptime. `send(cmd, arg)` writes a command. `stop()` closes stdin, waits, and kills an engine that outlived the teardown using `enginePidFile`. |
| `./hostProtocol` | `packages/supervisor-host/src/hostProtocol.ts` | The hand-written mirror of `HostProtocol.h`, partial on purpose: a field is added when a host first reads it. Read snapshots through `snapshotOf`, since a frame may omit an empty list. |
| `./stageEngine` | `packages/supervisor-host/scripts/stageEngine.mjs` | `stageEngine({repo, bin})`: copy the newest engine and supervisor builds (Debug last) into a staging `bin/`, with the ONNX Runtime libraries beside the supervisor and the Faust `.lib` files into `faust-libs/` (found through the engine's `CMakeCache.txt`). `$STUDIO_PREBUILT_BIN` copies an already staged `bin/` instead, which is how CI packages binaries built by another job. |

It depends on `@frediverse/electron-shell` (from the `commons/` submodule) for logging. The test (`packages/supervisor-host/src/supervisorHost.test.ts`) drives a fake supervisor, a node script speaking the same NDJSON.

## `apps/k7-standalone` (Electron)

`apps/k7-standalone/src/`:

| File | Role |
|---|---|
| `main.ts` | Boot: state dirs, port check, backend environment, the engine bridge, the supervisor, the backend, the window. Stop: the supervisor first (it deregisters from the backend, which must still be up), then the backend. |
| `paths.ts` | Where code and binaries are: packaged from `process.resourcesPath` (`backend/`, `bin/`), unpackaged from the checkout (backend source under tsx, the newest `engine/*/build/*` binaries). State under Electron's `userData`, never `~/.k7`. |
| `backends.ts` | Starts k7's backend with electron-shell's `startServer`: the bundle's `bin/backend.mjs` under Electron-as-node when packaged (with `STUDIO_FILE_SERVICE_ENTRY` pointing at the bundled file service), else the source |
| `supervisor.ts` | The supervisor over `<userData>/engine-home` and engine port **8766**, with `STUDIO_REGISTRY_URL` set to the local backend. Writes a first `engine-host.json` once; after that the file belongs to the supervisor. |
| `engineBridge.ts` | Pushes each snapshot to pages of the app's own origin on `studio:engine`, answers `studio:engine:state`, and forwards `studio:engine:cmd` for an allow-list only: `engine.start`, `engine.stop`, `engine.restart`, `audio.priority`, `plugins.rescan`, `instruments.download`, `instruments.remove`. A page from elsewhere cannot stop the engine or rank devices. |
| `preload.ts` | Exposes `__STUDIO_PORTS__` (synchronously, since pages derive service URLs at import time), `studioEngine`, `studioTab`, `studioTabs` |
| `window.ts`, `tabs.ts`, `routing.ts` | One frameless window whose title bar is k7's `/@tabs` page; a `WebContentsView` per tab (a pinned home tab and one per project); `routing.ts` decides, purely, whether a navigation goes home, to a project tab, in place, to sign-in or to the system browser |
| `signIn.ts` | Sign-in in the system browser (RFC 8252): a loopback listener receives a one-use code, useless without the PKCE-style verifier the main process keeps |
| `pairSync.ts`, `server.ts` | Pair the signed-in account with a server's sync relay through the system browser; the chosen server (default `https://st0.app`, overridable with `K7_SYNC_ORIGIN`) is kept in `server.json` |

`main.ts` sets `STUDIO_PORTS=k7=18789` in its own environment so the backend, its file services and the supervisor all derive the same loopback addresses. It clears and blocks service workers on the local origin, and treats any removal of the `studio.sid` cookie (other than an overwrite) as a sign-out, returning the window to the local user.

What the shell provides, from `@frediverse/electron-shell`: `boot` (`assertPortsFree`, `persistentSecret` for `SESSION_SECRET`), `lifecycle` (`runApp`: single instance, quit sequence), `log` (`openLog`, `line`), `servers` (`startServer`, `stopServer`, `waitListening`: child servers under Electron-as-node that die with the app), and `builder` (`baseConfig` for electron-builder).

### Running and packaging

```sh
npm run desktop:dev                              # build main.cjs and start Electron on the checkout
npm run package --workspace k7-standalone        # main, stage, electron-builder
```

`apps/k7-standalone/scripts/stage.mjs` builds `staging/`: the backend bundle and `bin/` from `stageEngine`. `electron-builder.cjs` produces a `.dmg` (macOS, unsigned, with a microphone usage string), an NSIS installer (Windows) and an AppImage (Linux). The `appId` `org.parapluie.k7.standalone` must not change once shipped: macOS keys microphone grants and single-instance on it. The engine and supervisor must have been built first ([87](./87-engine-build-and-shipping.md)).

`apps/k7-standalone/src/routing.test.ts` covers the navigation table; nothing else in the app is unit-tested, so run it to check a change.

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
| `SupervisorHost.kt` | The NDJSON channel (what `supervisorHost.ts` is on desktop); pins the local backend first in `registryUrls` |
| `EngineBridge.kt`, `EngineOps.kt` | The in-process engine; LAN address, CA import and forget (which restart the supervisor, which then adopts the running engine) |
| `EnginePlugin.kt` | Capacitor plugin `K7Runtime` for the tray page: `state` and `engineExit` events, commands, quit |
| `AppViewsPlugin.kt` | Each studio app (k7, the media library, the rehearsal recorder) in a full-screen WebView of its own, loaded from the connected studio, created once and then only hidden so it keeps its state |
| `StudioBridge.kt` | `window.k7Android` for those views: status bar colour, account, media session for everyone; the engine (k7's settings panel, `apps/k7/frontend/src/settings/androidEngine.ts`) for k7's origin only, checked per message |
| `AuthHandoff.kt`, `SyncPairing.kt` | Sign-in and sync pairing through the system browser, mirroring the desktop's |
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
