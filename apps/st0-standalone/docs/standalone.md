# st0-standalone — st0 and its media library as one desktop app

```bash
npm run desktop:build                                # once, and after a frontend change
npm run desktop:dev                                  # run from the checkout
npm run package --workspace st0-standalone           # out/ — a .dmg on macOS
```

The whole hosted studio on one machine: st0's backend — the media library included — the file
service it starts per account, the supervisor and the engine it starts — and a window on st0. Nothing reaches the
network unless a page asks for something remote.

## What it runs, and from where

st0's backend, run the way `@frediverse/electron-shell` runs any server: with Electron as its node,
in a process group that dies with the app (`commons/packages/electron-shell/docs/shell.md`).
**Packaged, it is the BUNDLE the phone runs too**, started from the same table of port, environment
and folders (`apps/st0/backend/docs/standalone.md`); unpackaged, the checkout's source under tsx, so
an edit needs no bundling. What is particular to this app:

- **The inherited `ELECTRON_RUN_AS_NODE` is what keeps the backend's children node.** Its file hub
  starts each file service with `process.execPath`, and so does the song compiler's DSP runner.
- **The file services are the backend's children**: its signal handler stops them, and the guard's
  process group is what takes them down when the backend dies without running it.
- **The supervisor needs no guard**: its stdin closing is already what stops it.
- The packaged app carries a 67 MB backend — bundle, frontend, demos and library — and the engine
  and supervisor beside it (`scripts/stage.mjs`).

## Addresses

st0 on `127.0.0.1:18789` — **not** the dev session's 8789, so the app runs beside `npm run dev`.
Every service derives a sibling's address from its own, and on a loopback host that means a PORT
table (`servicePorts` in `packages/web-protocol/services.ts`): the app publishes its port as `STUDIO_PORTS=st0=18789`, in the environment its children
inherit — the backend, the file services, the supervisor, whose `Url.cpp` reads the same
variable — and, for the pages, as `__STUDIO_PORTS__` from `src/preload.ts`. A preload rather than a
fetch because the pages compute the services' addresses synchronously at import time. Every window
gets it, the ones a page opens included. Opened in an ordinary browser, the same pages would fall
back to 8789 and reach the dev backend.

The port is fixed, not picked free at each launch: a page's storage is keyed on its ORIGIN, port
included, so a moving port would empty it every time.

**No service worker.** The app clears the stored ones before its window opens and refuses
`/sw.js` (`noServiceWorker` in `src/main.ts`). A worker stored by an earlier run hangs the
window's first navigation for good — a blank window, with the backend answering instantly to
anything else — and a local origin has nothing to gain from it: there is no network to survive,
and a precached shell would serve the previous build after every `build:frontends`.

Unix sockets would not replace it. A page reaches st0 through fetch, cookies, CORS and
WebSockets, all of which need an http origin; a custom Electron scheme carries no WebSocket; and
the engine is reached on TCP directly.

Plain http on loopback is enough: `127.0.0.1` is a secure context, and the session cookie is
host-only and `Lax`. `COOKIE_DOMAIN` is therefore forced empty — set, it would make the cookie `Secure`.

## Sign-in

Optional: signed out, the app runs as a **local user**; signed in, as an st0 account. The button
at the right of the title bar does both, and `docs/signIn.md` is the page.

The session secret is generated once and kept in the state folder. The local user has no
groups, so **it is never an admin** — it cannot edit the origin's libraries. The app therefore
hands the hub its own seed.

## The library

A project opens only once the origin has a library (`packages/project-shell/docs/launch.md`).
The app sets `STUDIO_LIBRARY_SEED=st0=<folder>`: the `st0-library` folder from a checkout, or in
the packaged app the newest PUBLISHED version the build could fetch, `library.yaml` included
(`apps/st0/backend/scripts/libraryArchive.mjs`). With no list written, the hub lists the seed's `st0`
and installs it under its version number in `workspaces/libraries/st0` on first ask; no network. An
update of the app carrying a newer version adds it beside the others, and the workspaces move to it
with `library upgrade` (`docs/library-versions-plan.md`). Delete that folder to reseed.
Once an account is paired (`docs/sync.md`), the copy FOLLOWS the origin's library, read-only: it
is rewritten to the origin's text, binaries included, and an edit made here is put back
(`packages/file-hub/docs/fileHub.md`). Never paired, the seed's copy is the library.

## The engine

The supervisor is run by `@studio/supervisor-host`'s `SupervisorHost`, the way the tray runs it —
no arguments, NDJSON on stdio, stdin held open for the app's life, relaunched when it crashes
(`packages/supervisor-host/docs/supervisorHost.md`). It gets a home of its own and
engine port **8766**, not the tray's `~/.st0` and 8765: the supervisor adopts whatever engine
already listens on its port, and its lock is per home, so the two coexist. Its first run
downloads its sample packs into that home, like any fresh supervisor home.

Quit stops the supervisor first — it deregisters from st0's registry, which must still be up —
then kills the engine named by its pidfile if it survived, then the backend.

## State

Everything lives under the OS's per-app folder (`~/Library/Application Support/st0-standalone`
on macOS): `workspaces/` (`$STUDIO_FILES_ROOT`), `mediatek/`, `prefs/`, `server-home/`,
`engine-home/`, `session-secret`, and `standalone.log`, the merged log of every process.

## Packaging

`scripts/stage.mjs` builds `staging/` — the frontend, then the backend bundle, then the engine and
the supervisor — which the shell's builder config copies into Resources. The build is unsigned:
partially signed, Gatekeeper kills the unsigned children.

External tools stay external, as in st0's image: `ffmpeg`, `yt-dlp`, `mpv` — found on `PATH` or
through their `*_BIN` variables.

## Why Electron

The shell has to be a browser engine st0 already runs on, and to run node beside it.

- **Not Tauri.** It draws in the OS's web view — WebKit on macOS and Linux — and st0 depends on
  what that engine lags on or lacks: WebGL (the viewport, `@studio/ui-eyes`, and the chains
  canvas) and the modern web protocols the studio is built on — WebRTC to the engine's machine,
  WebSockets on loopback, the audio and media APIs. Electron ships Chromium, the browser st0 is
  developed and tested in, at a version the app pins. Tauri would also need node as a sidecar for the
  backend, which Electron already is.
- **Not Capacitor.** It has no desktop target of its own: its desktop platform is a community one
  running on Electron, so it would add a layer and remove nothing. The phone uses it only for its
  page's two plugins (`engine/st0-engine/docs/android.md`).
