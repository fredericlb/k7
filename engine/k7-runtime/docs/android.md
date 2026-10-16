# The engine on Android

The same engine and the same supervisor, built for arm64 Android by their `android-arm64` presets
and run by the app in `engine/k7-android`, which drives the supervisor as the desktop app does. The supervisor lists the
phone at the studios it is connected to, exactly as on desktop, and the engine serves the same
WebSocket protocol on port 8765, bound to every interface.

**It lives as long as `MainActivity`**, and leaving it deregisters the engine, stops it and ends the
process. That teardown runs on a thread of its own, never the UI thread, since its stops wait for
seconds and a blocked main thread is an ANR; the backend gets longer than its own 8 s stop, so its
file services are not killed mid-teardown. The one service, `MediaPlaybackService`, keeps that process in front while a page plays
(below), and starts nothing of its own.

## Standalone: the phone runs its own studio

Like the desktop app (`apps/k7-standalone/docs/standalone.md`), the phone needs no server: it runs
**k7's backend itself**, with the file services that backend starts, and the engine. A studio
elsewhere is something it can ADD, never something it needs. `BackendHost.kt` is the desktop's
`main.ts` on a phone.

| choice | why |
|---|---|
| the desktop's port, environment and folders, read from `apps/k7/backend/standalone.json` | one table for both, whose values `apps/k7/backend/docs/standalone.md` explains; the port is a `BuildConfig` constant, since the views compare origins before anything is unpacked |
| the local user when signed out | a view opens on `/auth/local`, and falls back to it whenever `/auth/me` says nobody — the cookie watch the desktop does, with the signal the views already had |
| the phone's own studio pinned FIRST in the supervisor's list, before it starts | the supervisor's saved list overrides `$STUDIO_REGISTRY_URL`, so a phone that already listed a studio would never see its own otherwise |
| Termux's arm64 node, as `lib*.so` (`engine/k7-android/scripts/termux-tools.mjs`) | no other build of node runs as an Android app; the native library directory is the only place an app may execute a file, and only `lib*.so` names reach it. Library names and the Termux prefix are patched in place, same length, so nothing is relinked. Each `.deb` is the one pinned, by file and SHA-256, in `engine/k7-android/scripts/termux-packages.json`, and a download that does not match fails the build: Termux's index is unsigned as the script reads it, so it is never trusted at build time. Termux keeps only current versions, so a pinned one disappears with the next upgrade and the build fails on a 404; `node engine/k7-android/scripts/termux-tools.mjs --pin` rewrites the table from the current index, a diff to review and commit. The versions shipped are recorded in `termux-versions.json` |
| the backend BUNDLED (`apps/k7/backend/scripts/bundle.mjs`), the packaged desktop's bundle | tsx needs esbuild's native binary, which Termux's node cannot load (`apps/k7/backend/docs/standalone.md`) |
| one `backend.zip` asset, unpacked once per install | node reads files, not assets; the APK's `lastUpdateTime` marks the copy, as for Faust's libraries |
| cleartext allowed for `127.0.0.1` only (`engine/k7-android/app/src/main/res/xml/network_security_config.xml`) | the local studio is plain http, as on desktop, and every other host stays https |
| the views wait for the backend before loading it | a first run spends a few seconds unpacking, and a load that fails then would put the error screen up for nothing |

A crashed backend is relaunched once after two seconds; a dead origin under the views is otherwise
only fixed by restarting the app.

## The app is also where the studio is used: k7, full screen

`MainActivity` is a Capacitor `BridgeActivity`. With a studio connected, **the screen is k7, edge
to edge, and nothing of the app's own**: no header, no tab bar. k7 is the one app with a view —
the media library and the rehearsal recorder are pages of it, reached from its home sidebar — so
`APP_IDS` (`engine/k7-android/web/src/native.ts`) holds k7 alone. A phone has no room for a second
header above the app's own.

The status bar above the app is painted **the colour of that app's top edge**, so the app's
header reads as running up under it. That colour is measured, not declared: `assets/top-color.js`
composites every layer under the page's top pixel on a one-pixel canvas — AppHeader's tint is
translucent oklch over the page, which no computed style gives back as one colour — and reports
it again when the route or the theme changes. The status bar's icons follow its luminance.

**This phone's engine is set in k7's settings** (the home page's cog), because on the phone
k7 is the only screen there is: the studios the engine is listed at, which one the apps open, the private CA,
Quit (`apps/k7/frontend/docs/settings.md`). The page bundled in the APK, `engine/k7-android/web`,
is only seen while there is **no studio to open**, or while the open one **fails to load** — then
no app is on screen to reach settings in, so it draws the same tray with a Retry.

Two ways from the page to the native half:

- **The shell page** uses two plugins `MainActivity` registers itself, typed once in
  `web/src/native.ts`: **`K7Runtime`** (`EnginePlugin.kt`), `SupervisorHost`'s snapshots and
  commands; **`AppViews`** (`AppViewsPlugin.kt`), one native WebView per app over the page. Each is
  created the first time it is shown and only hidden after that, so an app keeps its state while
  another is on screen. With k7 the only app, that is what keeps it alive under the tray page.
- **The studio app** gets `window.k7Android` (`StudioBridge.kt`), an androidx.webkit
  WebMessageListener. Every app posts its top colour on it; **only k7, checked by origin on
  every message, may call the engine** (`apps/k7/frontend/src/settings/androidEngine.ts`). The
  object is offered to every origin because the studio can change under a view that already
  exists, and a listener's origin rules are fixed when it is added; the check is per message
  instead.

**The apps load from a studio, never from the shell page.** Each app is same-origin with its backend
(relative `/api` and `/auth`, cookie sessions), so it is served by one: this phone's own by default.
The page takes the studios from the supervisor's own list, the phone's own first, and gives the view
`serviceUrl(origin, "k7")`, the mapping `UserMenu` uses — or, for the loopback one, `localServiceUrl`,
which is why the shell page and every view on the phone's own studio get `__STUDIO_PORTS__` (a
document-start script, the desktop's preload). With several studios connected, k7's settings pick
which one the apps open.

What the app views do that a browser would do on its own:

- **A link to an app with a view switches to it** instead of opening a window: `target=_blank` and
  cross-app links go to that app's view, at that URL. Only a link the *user* followed does this; a
  redirect stays in its view. Other hosts in a new window open in the browser. Every page of k7
  is same-origin with its `/auth`, so the views need no third-party cookies. Only `http`, `https`,
  `mailto` and `tel` are handed to another app; any other scheme a page names is dropped, since a
  `file:` or `intent:` URI handed out exposes or launches what it should not.
- **The microphone** goes to the studio's apps only (the rehearsal recorder's remote mic), and only once the app holds
  RECORD_AUDIO, which it asks for at start for the engine.
- **The private CA** covers the app views too: a certificate the WebView refuses only for its unknown issuer
  is accepted when `TrustedCas` holds that certificate or its issuer. The WebView hands over the leaf
  alone, so a studio whose certificate hangs off an intermediate needs the intermediate imported.
- **Back** walks the visible app's history. With none left it does what it always did: it finishes
  the activity, which quits.

**No `cap sync`.** Gradle stages the page the way it stages the engine: `stageShell` runs the
workspace's `npm run build` and lays `dist/` out as `cap copy` would (`public/`,
`capacitor.config.json`, an empty `capacitor.plugins.json`). `settings.gradle.kts` includes
`:capacitor-android` from the root `node_modules`, so `npm ci` at the repo root has to run before
Gradle. The config is `.json` for the reason phare's is: the Capacitor CLI trips over a `.ts` one
under TypeScript 7.

**Reaching the phone's own engine from k7.** k7 is an https page, and the engine serves plain
`ws://`. The WebView, like any browser, lets an https page open `ws://127.0.0.1` but blocks
`ws://<LAN IP>` as mixed content. The engine picker probes each address an engine announces and
keeps one that answers, so a blocked one is simply not chosen. Mixed content stays off.

## A media player to the system

A WebView implements the Media Session API and connects it to nothing: a page that sets one gets
no notification, no lock-screen controls and no headset buttons. The app makes that connection.
`assets/media-session.js`, a document-start script in every view, wraps `navigator.mediaSession`
and posts what the page sets to `StudioBridge` (`media`); `MediaPlayback.kt` holds a platform
`MediaSession` and its notification from those messages, and sends each system button back as
`media-action`, which the script hands to the page's own handler. The page code is the standard
API (`packages/ui-mini-player/docs/miniPlayer.md`) and knows nothing of Android.

| choice | why |
|---|---|
| wrap the API in the view rather than add a call to `window.k7Android` | the bar is shared and runs in browsers too; a page written against the standard is a media player in mobile Chrome and here alike |
| the platform `MediaSession` and `Notification.MediaStyle`, no androidx.media or Media3 | API 29 has all of it; Media3 is built around a `Player` the app does not have, since the sound is the page's |
| a `mediaPlayback` foreground service while it PLAYS, and only then | without one Android freezes a process whose activity is behind, sound included; paused, the service stops and the notification stays, detached, so play resumes from it |
| no `POST_NOTIFICATIONS` request | a media-session notification is exempt on Android 13+ |
| play, pause and next as notification actions too | Android 12 and older draw those rather than the session's controls |
| the notification dismissed is `stop` | it is the bar's close: the page closes its player and the session goes with it |
| the task swiped away or the activity left clears it | a detached notification would outlive the process it controls |

A foreground start can be refused when the app is behind (Android 12+); the notification then
shows without the service, and the log says so under `k7-media`. Every start of the service enters
the foreground before anything else — a placeholder notification when nothing plays — even a
start that only stops it: a `startForegroundService` left without its `startForeground` crashes
the app. So the service is stopped through a start that says so, never by `stopService`.

## Signing in happens in the browser

An identity provider refuses a WebView, and RFC 8252 §8.12 says it should: a page inside an app
can read what is typed into it. So the views never show one. A navigation to the studio's
`/auth/login` — k7's Sign in button, a redirect, a script — is cancelled in `AppViewsPlugin.kt` and
the sign-in opens in the system browser instead, through the studio's handoff
(`apps/k7/backend/docs/handoff.md`). The browser comes back to `se.frediver.k7://auth` with a
one-use code, `MainActivity` (`singleTask`, so the intent reaches the running one) hands it to the
plugin, and `AuthHandoff.kt` turns it into a session in k7's view with the verifier only this app
holds. The verifier is kept on disk: the process may be killed while the browser is in front.

The studio's own OIDC client is the one used, with its registered `redirect_uri`: nothing new to
register at the identity provider for the phone.

**The account is on k7's home page**, as on the desktop (`apps/k7/frontend/src/projects/AccountBar.tsx`):
not in a native bar over the views, because an account is chosen where its workspaces are listed, and
a bar over every page is height taken from all of them. The page tells it is in the app by
`window.k7Android`; its Sign in only goes to `/auth/login`, which the plugin catches as above, and its
Sign out reloads, so the plugin hears nobody and falls back to the local user. Who is signed in still
reaches the native half (`assets/account.js`), asked on every load and whenever the page comes back
to the front: that is what pairs an account and restores the local user.

**The code is loaded straight into k7's view**, never through the shell page: k7 is the one app
shown, and a page switch to the app already shown loads nothing. When Android killed the process
while the browser was in front, the answer is the intent that launches the next one, and it is the
view's first load.

## Pairing with the origin, as the desktop does

The phone runs the desktop's backend and hub, so it is a live-sync replica the same way
(`apps/k7-standalone/docs/sync.md`): an account PAIRED with the origin has its workspaces kept in
step with the origin's, and the phone's libraries follow the origin's read-only
(`packages/file-hub/docs/fileHub.md`). `SyncPairing.kt` is `pairSync.ts` in Kotlin, with the same
rules — once per account per run, never for the local user, refused when the browser is signed in
to the origin as someone else.

- **The token comes back on loopback, not through the app's scheme.** The origin hands a device
  token only to an http loopback return (`isLoopbackReturn`, `packages/web-protocol/pairing.ts`), so
  the app listens on `127.0.0.1` on a port of its own while the browser is in front; a second rule
  for phones would be a second hole to keep shut.
- **It starts when k7's view says who is signed in** (`assets/account.js`) on the phone's own
  studio, and the backend says that account is unpaired (`GET /api/sync/remote`). The pairing is
  stored with the view's session cookie, read from the `CookieManager`, so the backend knows which
  account it is for. The device is named after the phone's maker and model.
- **The listener lives in the app's process.** Android may freeze or kill a process whose activity
  is behind the browser: frozen, the browser's redirect waits until the app is back in front;
  killed, the answer is lost, and the next start asks again since the account is still unpaired.
- **The origin is `st0.app`**, web-protocol's `STUDIO_ORIGIN`: a phone connected to another studio
  uses that studio's own session and has nothing to pair.

## A library in the app, not a process it spawns

JUCE's Oboe backend asks Android's `AudioManager` for the device's rate and buffer through JNI, and
JUCE as a whole wants `Java.initialiseJUCE(context)` before anything else. A bare executable has no
JavaVM to give it. So on Android the `k7-runtime` target is a **shared library**, `libk7runtime.so`,
built from the same `STUDIO_SERVER_SOURCES` as the desktop binary (`server/CMakeLists.txt`) plus `server/android/EngineJni.cpp`, and
`server/main.cpp` — the CLI — is not built at all. `serve()` is the whole server on every platform;
the desktop `main()` calls it once its CLI modes have declined.

`com.rmsl.juce.Java` in the app is JUCE's bootstrap class under JUCE's own name, because the
engine's `JNI_OnLoad` (JUCE's) registers `initialiseJUCE` on exactly that class. JUCE's copy loads a
library called `juce_jni`; the app's loads `k7runtime`, which is where JUCE lives here.

## JUCE's message thread is a thread with a prepared Looper

On Android, JUCE posts every message through an `android.os.Handler` it creates with no argument —
which binds to the Looper of **the thread that first creates the MessageManager**. That decides the
whole shape:

- `EngineBridge` starts a plain `Thread` that calls `Looper.prepare()` and then `nativeServe`. The
  `EngineHost` constructor is the first JUCE call on it, so that thread becomes the message thread.
  Not a `HandlerThread`: a runnable posted to one already runs inside its `loop()`, and the engine
  looping it again would nest two loops that one quit then tears down together.
- `EngineHost::run()` calls `Looper.loop()`, which blocks and dispatches exactly as the desktop's
  `runDispatchLoopUntil` loop does. The rest of `serve()` is unchanged: its locals live on that
  stack for as long as the engine runs.
- `EngineHost::quit()` posts `quitSafely()` to that Looper, from its own thread. JUCE's
  `stopDispatchLoop()` would instead finish the app's Activity.
- **Once per process.** After the quit, JUCE is still bound to a Looper that cannot loop again, so an
  engine is restarted by a new process. `MainActivity` exits the process when it finishes.

Teardown after the quit posts a few messages to the dead Looper; Android logs "sending message to a
Handler on a dead thread" and drops them. That is the same as a desktop message posted after its
dispatch loop stopped: never delivered, and nothing waits for it.

JUCE forces `JUCE_MODAL_LOOPS_PERMITTED` to 0 on Android, so `runDispatchLoopUntil` does not exist
there. Every other caller of it is a CLI mode, which Android never runs, so they all go through
`pumpMessages()` (`engine/MessagePump.h`), a no-op on Android.

## The supervisor is a program the app runs; the engine is a library it loads

The supervisor needs no Java — no JUCE, no audio — and is built to be a child driven over NDJSON on
stdio, so it stays exactly that. The app packages it as `libk7supervisor.so`: only files named like
a library reach the native library directory, the one place Android lets an app execute its own
binary, and `useLegacyPackaging` has the installer extract them as real files. `SupervisorHost.kt`
is then what `SupervisorHost` (`packages/supervisor-host/src/supervisorHost.ts`) is to the desktop app — it starts the program, reads its frames, sends its commands,
and closes stdin to quit it.

Only the ENGINE changes hands. On desktop the supervisor spawns it and kills its process tree; here
it lives in the app, so `EngineProcess.cpp` asks instead:

- **start** emits an `engine` frame carrying the id, token and port it would have put in the
  child's environment, then waits for the port to answer. The app sets that environment and serves.
  The pidfile names the supervisor's PARENT, which is the process the engine is a thread of.
- **stop** emits the request and never kills anything: that pid is the app's own.
- An engine already serving is **adopted**, as on desktop — a supervisor the app restarted finds it.

**One supervisor per process, not per activity.** Android recreates an activity on its own — an
overlay change is enough, and `configChanges` does not cover it — and a second supervisor is refused
by the host lock while the first keeps drawing into the dead activity. So `SupervisorHost` is an
`object`, like `EngineBridge`: it starts once, keeps the last snapshot, and whichever activity is on
screen listens.

Two things a phone answers differently from a desktop:

- **Trusted roots.** Android keeps one file per CA, the updatable conscrypt module's set on Android
  14+ before the system image's, each a PEM followed by a text dump. `TrustRoots.cpp` reads the
  blocks out of them.
- **The machine's name.** `gethostname()` is "localhost" on every phone, so the app passes the name
  the user gave the device, else its model, as `STUDIO_MACHINE_NAME`, and that is what the picker
  shows.

No ONNX Runtime ships for Android, so the supervisor builds without stem separation: the job says
what is missing, as it does on any platform without the library.

**A private CA is the user's to add, in the app — and optional.** A studio with a public certificate
needs nothing: `st0.app` and `priv.st0.app` carry Let's Encrypt ones, which Android trusts as every
OS does, so the section is folded away unless a CA of the user's is already trusted, and says when
one is worth adding. A studio behind a private CA is exactly the case the
desktop answers from the OS store, and on Android the certificates a user installs in Settings are
out of an app's reach. So the app takes the CA itself, through the document picker — PEM or DER,
one or a bundle, parsed by the platform's X.509 factory so a file that is not a certificate is
refused rather than stored — and keeps them as one PEM file handed to the supervisor as
`STUDIO_EXTRA_CA_CERTS`. The supervisor reads its roots once, at start, so a change restarts it:
the running engine is adopted, never stopped, and only the CURRENT supervisor's `engine` requests
are obeyed, since the old one's last words — stop the engine — may still be in its pipe.

## The buffer: two bursts at least, and more when the phone underruns

JUCE's Oboe device calls back one hardware **burst** at a time — 96, 192 or 240 frames on most
phones — and the buffer size the engine sets is only how many frames Oboe keeps queued ahead of
that. The desktop's 256 (`docs/audioDevice.md`) snaps to the nearest whole burst, which on a
192- or 240-frame phone is ONE: no slack at all, so every callback that runs late — a core
migration, a frequency step, one heavy block of the graph — is an underrun. It is heard as clicks
and crackle laid over playback that otherwise runs on time, not as a stutter, which is what makes
it read like a DSP bug rather than a timing one. The emulator hides it: its device hands out 960.

So on Android the engine asks for **at least two bursts**, and `checkXRuns` reads the stream's
underrun count once a second: when it moved, the buffer goes up ONE size and the log says so
(`[audio] N underruns at X frames — buffer now Y`). It stops at 40 ms, JUCE's own default for a
low-latency Android device; past that the log says the cap was reached, once. Growing reopens the
stream, a short gap, bounded by the cap — against a crackle that would otherwise never stop. It
never shrinks back: a phone that underran once will again.

To check on a phone: `adb logcat -s k7-runtime` shows the buffer at open and every step.

## Build choices, and what forced each

| choice | why |
|---|---|
| The presets build, Gradle stages | AGP's `externalNativeBuild` would configure second CMake trees and fetch Tracktion into one. `app/build.gradle.kts` runs the engine's `scripts/build.mjs android-arm64` and `engine/scripts/supervisorBuild.mjs` with `STUDIO_SUPERVISOR_PRESET=android-arm64`, against the SDK's NDK, and copies both in. |
| API 29 | JUCE's Android font code calls `AFontMatcher`, which is 29+. AAudio, which Oboe prefers, only needs 26. |
| arm64-v8a only | every phone worth playing on; a second ABI doubles a 35 MB library for nothing. |
| No VST3 / LADSPA | there is nothing to host and no window for an editor. `loadVstPreset` answers false, as it does for a built-in. |
| Tracktion populated, not built from its root | its root always adds its examples, and `EngineInPluginDemo` depends on a VST3 target that does not exist here, so configure fails. `modules/juce` and `modules` are added by hand instead. |
| `JUCE_LOG_ASSERTIONS=0` | JUCE logs assertions in RELEASE on Android, which compiles Tracktion's `jassert (hasPrefetched)` against a member that only exists in debug. |
| `-Dtls_model(x)=unused` on `tracktion_graph.cpp` | the rpmalloc it compiles in pins its thread heap to initial-exec TLS, and Android's loader refuses that in a library opened by `System.loadLibrary` — the app dies loading the engine. The rewrite turns the attribute into `unused`. A compile OPTION, because CMake drops function-style definitions silently. `llvm-readelf -d libk7runtime.so` must not show `STATIC_TLS`. |
| `CMAKE_POLICY_VERSION_MINIMUM=3.5` | Oboe's own `CMakeLists.txt`, which JUCE adds on Android, declares a minimum CMake 4 refuses. |

## Faust's libraries travel as assets

`import("stdfaust.lib")` is resolved when the engine compiles a module, so the libraries must be on
the phone, as files: the Faust compiler opens them by path, and an asset is not one. Gradle copies
the 43 `.lib` files — 2 MB — out of the folder the engine's CMake cache names (`STUDIO_FAUST_LIBS`),
and fails when `stdfaust.lib` is not there, as the desktop staging does. The app unpacks them into
its files once per install, marking the copy done only once every file is written, and names the
folder in `STUDIO_FAUST_LIBS`, which `faustLibrariesDir()` reads before looking beside an executable
this platform does not have.

## In CI

OneDev's **android** job builds the APK for every release, beside the desktops, from a cold SDK install
pinned by version and checksum (`.onedev-buildspec.yml`), and GitHub's `android` job does the same.
Both build the RELEASE type, not debuggable, signed with the release key from their secrets
(`docs/desktop-release.md`); a debug build is for a developer's own phone, and replacing one with the
other needs the app uninstalled first.

## Logs

Everything the engine writes goes to stderr, which Android discards. `nativeServe` pipes stderr into
logcat under the tag `k7-runtime`; JUCE's own lines appear under `JUCE`. On the emulator the pipe
also catches the GL driver's chatter, which is noise.

## What it does not have yet

- **The standalone app has not been built and run as one APK yet.** Its backend and file service
  were run on the emulator as an app, with `BackendHost.kt`'s layout and environment (below); the
  APK itself, the view on the local studio and a sign-in through the browser are still to drive.
- **No ffmpeg, yt-dlp or mpv on the phone**: what needs them — transcoding, the hunt, the server-side
  player — answers as it does on a machine without them.
- **The rehearsal recorder's store is the server's**: SQLite under `K7_DATA_DIR`, as on desktop and on the server (`packages/rehearsal-server/docs/store.md`).
- **The tunnel and WebRTC are untested on a phone.** They are the desktop code, built unchanged; no
  studio has driven a phone through them yet.
- **No external plugins, no plugin scan, no offline render or freeze.**
- **No foreground service of its own**, so the screen is kept on and the engine stops with the activity.
  The media one runs only while a page plays.
- **The media session has not been driven on a phone yet**: background playback in a hidden view,
  the notification on Android 12 and 13+, and a headset's buttons are each still to check.
- **Pairing has not been run on a phone.** `SyncPairing.kt` was written against the desktop's flow
  and has not been compiled or driven; the browser reaching the app's loopback port while the app
  is behind it is the part to check first.
- **The app views have not been driven through a real sign-in on a phone yet.** The routing rules,
  the browser handoff, the home page's account control, the status-bar colour and k7's engine section above are
  the design; each needs checking against a live studio.

## What was measured

On an Android 15 arm64 emulator on an Apple Silicon Mac, with `scripts/measure-broadcast.mjs`
through `adb forward`:

| | measured |
|---|---|
| library load, JUCE init, port bound | 60 ms after launch |
| audio device | Oboe, 48 kHz, 1 in / 2 out, 960-frame buffer (the emulator's own) |
| a 4OSC note over 25 s | every frame carries signal, 0 dropped, 0 undecodable |
| jitter spread | 4.6–6.2 ms |
| realtime ratio | **0.88, steady** |
| Stop with a project loaded | the engine tears down and the process exits cleanly |
| supervisor start | 145 trusted roots read; engine started by the app with the supervisor's identity |
| connecting a studio (a stand-in registry through `adb reverse`) | hello answered, a heartbeat every 5 s carrying id, LAN addresses, name and performance |
| Quit | deregister sent, pidfile and host lock removed, both processes gone |
| a Faust module importing `stdfaust.lib` (−6 dB with `ba.db2linear`) | compiles, no warning; the note's peak halves, 0.64 → 0.32 |
| the same importing a library that does not exist | `faust: ERROR : unable to open file nosuch.lib`, and the audio passes untouched |
| an HTTPS studio whose certificate a private CA signed | refused; after importing that CA (DER) 146 roots, the engine adopted, connected and heartbeating; after forgetting it 145 and refused again — one engine start throughout |
| importing a file that is not a certificate | refused with a message; nothing stored, nothing restarted |
| `--probe https://priv.st0.app` with Android's CAs only | an k7 registry: nothing to import for a publicly certified studio |

The standalone backend, on the same emulator, run as an app (`run-as`) from the bundle and the
tools the scripts produce:

| | measured |
|---|---|
| backend answering, from launch | 270–300 ms |
| local sign-in, `/auth/me`, the frontend's index | the local user, `local: true`; 200 |
| first `/workspaces`, which starts the account's file service | 450 ms |
| resident memory | backend 81 MB, file service 100 MB |
| APK payload | `backend.zip` 50 MB (68 MB unpacked) |

The realtime ratio is the emulator's audio device consuming 12 % less than wall-clock time at a
nominal 48 kHz: steady from 8 s to 25 s, with nothing dropped, so the engine keeps up with the
device and the device is what runs slow. It says nothing about a phone. The number that matters —
latency and the ratio on real hardware with a real audio path — is still to be measured.
