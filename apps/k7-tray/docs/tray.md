# The tray

## Names, and the ones a rename may not touch

The binary and the displayed name are `k7-tray`; the engine it runs is `k7-runtime`. Those are build
artifacts, which the next build replaces.

**`org.parapluie.studio.engine-tray`, the bundle identifier, is frozen.** On macOS it is the app's identity:
changing it drops the microphone grant and the login item while leaving the old app registered. It also names
the folder the backend keeps its state in (the OS's per-app folder), so moving it reads as a first launch.

Neither may `<state>` (`~/.k7`) move, nor what is under it, nor the `STUDIO_*` variables
(`packages/engine-client/docs/paths.md`).

## k7 on a computer is the web app, opened in a browser

The tray opens no window. It starts k7's backend on `127.0.0.1` and opens that address in the person's
browser, where k7 installs as an app (its manifest and service worker are the hosted build's).

| choice | why |
|---|---|
| the browser, not a window of ours | one rendering engine to test against, the one the hosted app already runs in; no tabs, menus or window chrome to maintain |
| `127.0.0.1`, not `localhost` | loopback is a secure context, so the page installs and its service worker runs; `127.0.0.1` is what the sign-in redirect is registered for |
| the port fixed by `standalone.json` (18789) | a page's storage and its installed app are keyed on the origin, port included; the OIDC client accepts that redirect; a pairing's return lands there |
| offline by construction | the page, its backend, the file services and the engine are all on this machine; only signing in and syncing need the network |
| a remote engine stays the hosted app's | an HTTPS page cannot open `ws://` to the LAN, and the relay and WebRTC both need the server (`packages/engine-browser/docs/access.md`) |

The page tells it is served by a machine's own backend from that backend (`GET /api/local`), never from a
preload: the bundle is the same one every host serves (`apps/k7/frontend/docs/localApp.md`).

## One process, and the backend runs the supervisor

The tray starts node on the backend bundle and nothing else. The backend runs the supervisor over stdio, as
the phone's app does, and the engine settings page reaches it through same-origin routes behind the session.

| choice | why |
|---|---|
| the backend hosts the supervisor, not the tray | the supervisor listens on no port by design (a loopback port is one any page in the browser can `fetch()`, `engine/k7-supervisor/docs/hostProtocol.md`); routes of the backend inherit its loopback guard, its CORS policy and its session |
| the tray reads its status line from the backend, under a bearer it hands over at spawn | the wording is tested TypeScript (`trayStatus.ts`); the tray draws and decides nothing |
| `~/.k7` and the supervisor's own port (8765) | the tray's engine is the machine's engine, the one the command-line engine would be; servers list it, and it is what `k7.rocks` plays on through the tunnel |
| the backend pinned first in `engine-host.json` | `$STUDIO_REGISTRY_URL` is only a fallback once the person lists another server, and the page needs this engine in its own registry |
| node bundled, pinned and checksummed (`scripts/stage.mjs`) | the machine may have no node, or another major; the backend bundle targets Node 24 |

## Why Tauri

The tray needs an icon, a menu and a dialog, and no webview at all. Tauri gives those in a few megabytes of
Rust, where Electron would add about 300 MB and a Chromium for a window nobody opens. Rust also gives the
Windows job object directly (`job.rs`).

## The microphone is the tray's to ask for

On macOS the microphone grant belongs to the responsible app: the engine records through the backend and the
supervisor the tray launched, so the tray asks, and its Info.plist carries `NSMicrophoneUsageDescription`.
Without it macOS hands the engine silence: the take is written, all zeros.

## Updates

The tray keeps itself current from `k7.rocks/app_downloads/tray/<channel>/latest.json` with
tauri-plugin-updater (`docs/app-downloads.md` at the root).

| choice | why |
|---|---|
| tauri-plugin-updater, not our own download | it installs on Windows, macOS and the AppImage, and checks every update's signature |
| signed, with the key in CI secrets | the upload token alone would let whoever holds it ship code every tray runs; the public key is built in (`K7_UPDATER_PUBKEY`), and a build without it has no updater rather than one that trusts anything |
| the channel from the release stamp | a tag follows `release` and takes a higher tag; a snapshot follows `snapshot`, which only ever holds `main`'s latest build, and takes any other one; `dev` asks nothing |
| told once per build, the menu's check always answers, a switch to turn it off | as the phone's check does; kept in `updates.json` beside the backend's state |
| the backend stopped before the installer runs | the installer replaces binaries the backend and the engine are running, and a graceful stop deregisters the engine |
| a `.deb` is told, not updated | it belongs to apt; Download opens the page |

## Quitting

The backend's stop stops the supervisor first, which deregisters while the engine is still up, then stops the
engine. The tray waits 15 s for that, then kills what remains; `pidkill::backstop` reaches an engine a hung
supervisor left, since an engine that survives the app holds the audio device and is adopted by nobody next
launch. SIGTERM and SIGINT quit the same way: launchd stops a login item with SIGTERM.

## Launch at login

The autostart plugin: a login item on macOS and Windows, an XDG autostart entry on Linux.

## The merged log

`<state>/.studio.log` is the supervisor's file, which the web Logs panel reads by byte offset. The tray
truncates it once per launch, the one process that knows a session began, and files the backend's output there
under `[backend]`; the backend writes its supervisor notes under `[host]`. The format, `HH:MM:SS [tag] text`,
is that panel's contract.
