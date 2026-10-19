# The engine on iOS

The same engine, the same supervisor and the same backend as on Android (`docs/android.md`), run by the app in
`engine/k7-ios`. The architecture is Android's, part for part. The phone runs its own studio and needs no
server, the supervisor lists the phone at the studios it is connected to, the engine serves the same WebSocket
protocol on port 8765, and the screen is k7, full screen, in a view of its own. What differs is what iOS forbids.

| Android | iOS | what forces it |
|---|---|---|
| the supervisor, a program the app runs (`libk7supervisor.so`) | `k7supervisor.framework`, run on a thread of the app (`engine/k7-supervisor/src/Embedded.cpp`) | no iOS app may run a program of its own |
| node, Termux's binary | NodeMobile, node as a framework, `node_start` on a thread | the same |
| one file-service process per account | one worker thread per account (`packages/file-hub/workerChild.ts`) | no iOS app may start a process |
| the backend, a process relaunched on a backoff | the backend, a WORKER of `backend-boot.mjs`, relaunched on the same backoff | node runs once per process, and its `process.env` is the app's own environment |
| the engine, `libk7runtime.so`, on a thread whose Looper is JUCE's | `k7runtime.framework`, on a thread whose run loop is JUCE's | the engine is a library on both phones |
| the k7x reader as WebAssembly, inside `@studio/k7x` | `k7x.framework`, a Node-API addon `BackendHost.swift` names in `K7X_ADDON` | a JIT-less V8 has no WebAssembly (`packages/k7x/docs/rust.md`) |
| Android's CAs, read from the system's folders | a CA bundle the app ships (`cacert.pem`, Mozilla's set as curl publishes it) | iOS lets no app list its trusted roots |
| foreground services while busy | background audio, released while idle | iOS keeps a running audio app alive, and suspends one that stops |

## The process

Everything is ONE process: the engine, the supervisor, node, the backend, the file services and the views.
iOS gives an app no child, so every part that is a program elsewhere is a library here, and each keeps the
interface it has as a program:

- **The supervisor** speaks its NDJSON over two pipes the app holds, not over stdio (`k7_supervisor_run`,
  `SupervisorHost.swift`). Its frames have a descriptor of their own (`sendFramesTo`), because the app's stdout
  is shared with node and the engine. It installs no signal or crash handler and never exits. Closing the command
  pipe is its quit, as closing stdin is on desktop. Its `engine` requests are the app's to carry out, as on Android
  (`K7_ENGINE_IN_APP`, `src/Platform.h`). It is started again IN the process after a CA change. Each run's loop is
  left allocated, since a `work()` thread may still post to it, and the roots are read again (`forgetRoots`).
- **Node** runs `backend-boot.mjs`. That script starts the bundled backend on a worker thread and stops it, on
  orders from `BackendHost.swift` over two more pipes. The worker is the reason the backend can crash and be
  relaunched, which node itself cannot be, and the reason its environment is its own. A worker's `process.env` is a
  copy, while node's main thread writes through to the one the engine and the supervisor read; `STUDIO_HOME` alone
  means three different folders to them. Nothing on node's main thread calls `process.exit`, which would end the app.
  The engine's `.k7` is not the backend's `standalone` folder, whose files it is sent by their own paths, so
  `EngineBridge.start` sets `$STUDIO_ENGINE_ROOTS` to the backend's workspaces and médiathèque
  (`BackendHost.engineRoots`, from the bundled table): outside its roots the engine drops every file (`pathRoots.md`).
- **The file services** each run on a worker thread of the backend. A worker has module globals of its own, so an
  account is kept apart as a process keeps it. Its stdin end is still its stop, so the file service runs unchanged.
  `STUDIO_FILE_SERVICE_THREADS=1` selects this mode, and it needs the bundled entry, since a thread runs plain JS
  and not tsx.
- **The engine** opens its device without inputs until the microphone is granted (`STUDIO_ENGINE_INPUTS`). JUCE's
  iOS device asks for the microphone the moment inputs open, and JUCE's `RuntimePermissions` answers "granted"
  on iOS whatever the truth.
- **Spawning anything** — ffmpeg, mpv, the engine's `--decode`, a stem cut — fails at once with a reason, in the
  simulator too (`Processes.cpp`). The simulator would let it through, and it must not promise what a phone refuses.

**stdout and stderr go to the system log** (`StdioLog.swift`), subsystem `se.frediver.k7`, with each line keeping
its own tag (`[host]`, `[engine]`, `files |`). An app's own streams reach no Console a device shows.

| choice | why |
|---|---|
| frameworks, not static libraries, for the engine and the supervisor | the linker folds every archive each one links into it, with no list of dependency targets to keep in step; and they are the `.so` files Android loads |
| NodeMobile from `fogtape/nodejs-mobile`, pinned by file and SHA-256 in `engine/k7-ios/scripts/pins.json` | the original nodejs-mobile stops at Node 18; the backend is bundled for node24 and imports `node:sqlite`. This one is built from the official tag (24.21.0), full flavour, since lite drops SQLite. A single maintainer, so it is never trusted at build time: a mismatch fails the stage |
| NodeMobile's V8 is JIT-less | Apple allows no JIT to an app. Measured below, it is no obstacle to a server of YAML and HTTP |
| the CA bundle pinned the same way | the supervisor's mbedTLS needs roots as PEM, and iOS gives none; a studio behind a private CA is the user's to add, as on Android |
| the bundle's files read where they lie, in the app bundle | an app bundle is a folder of real files, so nothing is unpacked: no `backend.zip`, no first-run percentage, no copy of Faust's libraries |
| cleartext to loopback only (`NSAllowsLocalNetworking`) | the phone's own studio is plain http, as on desktop; every other host stays https |
| iOS 17 | `AVAudioApplication`, which says the microphone's state in one call; every iPhone from 2018 on runs it |

## The views

The shell page is Android's own (`engine/k7-android/web`), built by the same workspace. Its two plugins,
`K7Runtime` and `AppViews`, are registered by the Swift half with the same methods and events
(`EnginePlugin.swift`, `AppViews.swift`). k7 gets `window.k7Ios` (`StudioBridge.swift`), the protocol of
Android's `window.k7Android` under the platform's name. `apps/k7/frontend/src/settings/androidEngine.ts` takes
whichever is there, and the three page scripts both apps inject accept either (`engine/k7-android/app/src/main/assets`).
Only k7 may call the engine, checked by origin on every message, with Android's short list of commands and its
native confirmations.

Where iOS does a thing itself, the app lets it:

| Android | iOS |
|---|---|
| a Custom Tab for the sign-in, the verifier kept on disk | `ASWebAuthenticationSession`, a sheet over the app: the app stays in front, so the verifier stays in memory |
| pairing state on disk, for a process killed behind the browser | none: the browser is the same sheet, the loopback listener answers while it is up, and the app closes it once the answer is in |
| `download.js` fetching blobs in 512 KiB chunks | `WKDownload`, which takes a `blob:`, `data:` or same-origin URL with the session's cookies; the file lands in Documents/Downloads, which the Files app shows under k7 |
| `back.js` and the Back button | the edge swipe, over the view's own history |
| `CertTrust.kt` checking the leaf's name and dates | iOS's own trust evaluation with the imported CAs as anchors (`TrustedCas.swift`): a wrong name, an expired date or a certificate iOS's TLS rules refuse is refused here too. Android's rule stands: an imported non-CA is trusted as that exact leaf and never as an issuer, read from its DER since iOS has no public API for extensions (`CertTrust.swift`) |
| the window's insets | the safe area; the strip under the status bar is painted the app's top colour, and the status bar's icons follow its luminance |

The microphone goes to the studio's apps only, asked when first needed (`MicAccess.swift`). A refusal iOS
remembers offers the app's Settings. A grant that comes after the engine started reaches it at the next start, and
Quit is the one restart there is. Quitting is the app ending its own process, which an App Store app does not do:
it is kept because a stopped engine cannot start again in the same process.

**A media player to the system**, as on Android: `media-session.js` relays the page's Media Session, and
`MediaPlayback.swift` holds Now Playing and the remote commands. The bar may play through the engine, which
WebKit knows nothing of, so this is not left to WebKit's own media.

## Busy: the hold is the default, and its release is the decision

iOS keeps an app with background audio running for as long as its audio device runs. The engine's device always
runs, so the app would never be suspended: a phone kept awake by silence. So `Busy.swift` decides when to LET GO.
Behind another app, with nothing playing, armed, recording, live or holding a microphone, the engine closes its
device (`k7_engine_suspend_audio`, `EngineHost::suspendAudio`) and iOS may suspend the app. It reopens it from the
setup JUCE holds when the app comes back. The reasons are Android's, from the same two sources: the supervisor's
`sessions[].playing`, and the pages' `busy` messages. The screen is kept on while a page reports anything
(`isIdleTimerDisabled`).

An app suspended behind another drops off every studio until it is back in front: its supervisor sends no
heartbeat while suspended.

## Building

```
node engine/k7-ios/scripts/stage.mjs           # a device; --sim for the simulator on an Apple Silicon Mac
open engine/k7-ios/k7.xcodeproj                 # pick a team under Signing, then Run
```

`stage.mjs` builds the engine's `ios-arm64` preset and the supervisor's, each as an xcframework, and fetches
NodeMobile and the CA bundle as pinned. It copies Faust's libraries out of the engine's CMake cache, builds the
shell page and lays it out as `cap copy` would, and bundles the backend with `apps/k7/backend/scripts/bundle.mjs`.
`--only=<part,…>` restages some parts.

| choice | why |
|---|---|
| staging is a step BEFORE Xcode, not a build phase | Xcode plans an xcframework's slices when the build starts, so one staged mid-build is not seen; Android's Gradle has no such phase to fight |
| Capacitor from `capacitor-swift-pm`, exactly 8.5.2 | Capacitor's npm package ships no Swift package; this one ships the same release as checksummed xcframeworks. Kept at the version the page's `@capacitor/core` resolves to |
| the project file written by hand, its sources a folder Xcode keeps in sync | no generator to install, and a new Swift file joins the target by being in `k7/` |
| signing left to the developer's own team | no team is committed; `CODE_SIGN_STYLE` is automatic |
| JUCE's `juceaide` built at the Mac's own deployment target (`engine/patches/tracktion.cmake`) | JUCE builds that tool for the build machine in a nested CMake and hands it the preset's deployment target, which under `ios-arm64` is an iPhone floor no macOS has |

## What it does not have yet

- **The engine is built for iOS, not yet run.** `ios.yml` compiles and links `k7runtime.framework` into the app
  (23 minutes cold); the audio session JUCE sets up, background playback and the device's close and reopen are
  all still to drive. JUCE's iOS device asks for `MixWithOthers`, which keeps an app out of Now Playing: the lock
  screen's controls may need the category changed.
- **Not run on a phone**, only on the simulator (below). Sign-in through the browser, pairing, the private CA,
  downloads, the microphone flow and the local-network prompt are compiled, not driven.
- **No release signing.** `.github/workflows/ios.yml` builds an UNSIGNED `.ipa` for a device as an artifact,
  attached to a version's release but never to the snapshot (`docs/desktop-release.md`); signing it is the
  developer's own team, as for a local build.
- **Node warns about file descriptors** in the file service's worker ("closed but not opened in unmanaged mode").
  The service answers regardless; where the descriptors come from is still to find.
- **No stem separation**: no ONNX Runtime ships for iOS in a form the supervisor loads.

## What was measured

On the iOS 26.5 simulator (iPhone 17) on an Apple Silicon Mac, with the real supervisor, NodeMobile and backend,
and a stand-in for the engine:

| | measured |
|---|---|
| launch to the backend answering its registry's hello | 0.4 s |
| the account's file service, on a worker thread | up 1.8 s after launch, serving the seeded workspace |
| the supervisor | its snapshot on the shell page, its heartbeat at the phone's own registry as "iPhone 17", its tunnel up |
| the view | k7's home page from the phone's own studio, as the local user, the strip painted its header's colour |
