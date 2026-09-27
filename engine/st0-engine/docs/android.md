# The engine on Android

The same engine and the same supervisor, built for arm64 Android by their `android-arm64` presets
and run by the app in `engine/st0-android`, which plays the tray's part. The supervisor lists the
phone at the studios it is connected to, exactly as on desktop, and the engine serves the same
WebSocket protocol on port 8765, bound to every interface.

**Foreground only.** There is no service: both live as long as `MainActivity`, and leaving it
deregisters the engine, stops it and ends the process.

## The app is also where the studio is used: st0, pl8 and k7 in tabs

`MainActivity` is a Capacitor `BridgeActivity`. Its WebView shows `engine/st0-android/web`, a small
React page bundled into the APK: a header whose buttons switch between **st0**, **pl8**, **k7** and
the **engine** tab, which is the tray this activity used to draw natively (the studio list, "Connect a
studio", the private CA, Quit). The page reaches the native half only through two plugins that
`MainActivity` registers itself, typed once in `web/src/native.ts`:

- **`St0Engine`** (`EnginePlugin.kt`): `SupervisorHost`'s snapshots as `state` events and its commands
  as methods. `SupervisorHost` itself is unchanged.
- **`AppViews`** (`AppViewsPlugin.kt`): one native WebView per app, laid over the page's WebView below
  the header's measured height. Each is created the first time its tab opens and is only hidden after
  that, so an app keeps its state while another is on screen: a k7 session, a playing pl8 track.

**The apps load from the studio, not from the APK.** Each app is same-origin with its backend
(relative `/api` and `/auth`, cookie sessions), so a bundled copy would be an app with no server.
The page takes the studio from the supervisor's own list and gives each tab
`serviceUrl(origin, "st0" | "pl8" | "k7")`, the mapping `AppSwitch` uses. With several studios
connected, the engine tab picks which one the tabs open.

What the app views do that a browser would do on its own:

- **A link to a sibling app switches tab** instead of opening a window: `AppSwitch`'s links,
  `target=_blank` and cross-app links all go to that tab, at that URL. Only a link the *user* followed
  does this. A redirect stays in its view, since the sign-in flow bounces pl8 and k7 through st0's
  `/auth`. Other hosts in a new window open in the browser.
- **The microphone** goes to the studio's apps only (k7's remote mic), and only once the app holds
  RECORD_AUDIO, which it asks for at start for the engine.
- **The private CA** covers the tabs too: a certificate the WebView refuses only for its unknown issuer
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

**Reaching the phone's own engine from st0's tab.** st0 is an https page, and the engine serves plain
`ws://`. The WebView, like any browser, lets an https page open `ws://127.0.0.1` but blocks
`ws://<LAN IP>` as mixed content. The engine picker probes each address an engine announces and
keeps one that answers, so a blocked one is simply not chosen. Mixed content stays off.

## A library in the app, not a process it spawns

JUCE's Oboe backend asks Android's `AudioManager` for the device's rate and buffer through JNI, and
JUCE as a whole wants `Java.initialiseJUCE(context)` before anything else. A bare executable has no
JavaVM to give it. So on Android the `st0-engine` target is a **shared library**, `libst0engine.so`,
built from `server/Serve.cpp` and `server/DocJson.cpp` plus `server/android/EngineJni.cpp`, and
`server/main.cpp` — the CLI — is not built at all. `serve()` is the whole server on every platform;
the desktop `main()` calls it once its CLI modes have declined.

`com.rmsl.juce.Java` in the app is JUCE's bootstrap class under JUCE's own name, because the
engine's `JNI_OnLoad` (JUCE's) registers `initialiseJUCE` on exactly that class. JUCE's copy loads a
library called `juce_jni`; the app's loads `st0engine`, which is where JUCE lives here.

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
stdio, so it stays exactly that. The app packages it as `libst0supervisor.so`: only files named like
a library reach the native library directory, the one place Android lets an app execute its own
binary, and `useLegacyPackaging` has the installer extract them as real files. `SupervisorHost.kt`
is then what `host.rs` is to the tray — it starts the program, reads its frames, sends its commands,
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

To check on a phone: `adb logcat -s st0-engine` shows the buffer at open and every step.

## Build choices, and what forced each

| choice | why |
|---|---|
| The presets build, Gradle stages | AGP's `externalNativeBuild` would configure second CMake trees and fetch Tracktion into one. `app/build.gradle.kts` runs the engine's `scripts/build.mjs android-arm64` and the tray's `supervisorBuild.mjs` with `STUDIO_SUPERVISOR_PRESET=android-arm64`, against the SDK's NDK, and copies both in. |
| API 29 | JUCE's Android font code calls `AFontMatcher`, which is 29+. AAudio, which Oboe prefers, only needs 26. |
| arm64-v8a only | every phone worth playing on; a second ABI doubles a 35 MB library for nothing. |
| No VST3 / LADSPA | there is nothing to host and no window for an editor. `loadVstPreset` answers false, as it does for a built-in. |
| Tracktion populated, not built from its root | its root always adds its examples, and `EngineInPluginDemo` depends on a VST3 target that does not exist here, so configure fails. `modules/juce` and `modules` are added by hand instead. |
| `JUCE_LOG_ASSERTIONS=0` | JUCE logs assertions in RELEASE on Android, which compiles Tracktion's `jassert (hasPrefetched)` against a member that only exists in debug. |
| `-Dtls_model(x)=unused` on `tracktion_graph.cpp` | the rpmalloc it compiles in pins its thread heap to initial-exec TLS, and Android's loader refuses that in a library opened by `System.loadLibrary` — the app dies loading the engine. The rewrite turns the attribute into `unused`. A compile OPTION, because CMake drops function-style definitions silently. `llvm-readelf -d libst0engine.so` must not show `STATIC_TLS`. |
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

OneDev's **build android app** job builds the APK nightly, like the desktops, from a cold SDK install
pinned by version and checksum (`.onedev-buildspec.yml`). It is DEBUG-signed: there is no release
key, and a sideloaded debug APK is what a phone on the bench needs.

## Logs

Everything the engine writes goes to stderr, which Android discards. `nativeServe` pipes stderr into
logcat under the tag `st0-engine`; JUCE's own lines appear under `JUCE`. On the emulator the pipe
also catches the GL driver's chatter, which is noise.

## What it does not have yet

- **The tunnel and WebRTC are untested on a phone.** They are the desktop code, built unchanged; no
  studio has driven a phone through them yet.
- **No external plugins, no plugin scan, no offline render or freeze.**
- **No foreground service**, so the screen is kept on and the engine stops with the activity.
- **The app tabs have not been driven through a real sign-in on a phone yet.** The routing rules
  above are the design; each needs checking against a live studio.

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
| `--probe https://priv.st0.app` with Android's CAs only | an st0 registry: nothing to import for a publicly certified studio |

The realtime ratio is the emulator's audio device consuming 12 % less than wall-clock time at a
nominal 48 kHz: steady from 8 s to 25 s, with nothing dropped, so the engine keeps up with the
device and the device is what runs slow. It says nothing about a phone. The number that matters —
latency and the ratio on real hardware with a real audio path — is still to be measured.
