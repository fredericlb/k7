# st0-standalone — st0 and pl8 as one desktop app

```bash
npm run build:frontends --workspace st0-standalone   # once, and after a frontend change
npm start --workspace st0-standalone                 # run from the checkout
npm run package --workspace st0-standalone           # out/ — a .dmg on macOS
```

The whole hosted studio on one machine: st0's backend, pl8's backend, the file service pl8 starts
per account, the supervisor and the engine it starts — and a window on st0. Nothing reaches the
network unless a page asks for something remote.

## What it runs, and from where

st0's and pl8's backends, run the way `@studio/electron-shell` runs any server: unchanged, under
tsx with Electron as their node, each in a process group that dies with the app. The reasons are
that package's (`packages/electron-shell/docs/shell.md`); what is particular to this app:

- **The inherited `ELECTRON_RUN_AS_NODE` is what keeps pl8's children node.** pl8's file hub
  starts each file service with `process.execPath`, and so does the song compiler's DSP runner.
- **pl8 handles no signal**, so its file services would outlive it without the guard's process
  group.
- **The supervisor needs no guard**: its stdin closing is already what stops it.
- The packaged app is ~580 MB on macOS, since it carries source plus `node_modules`
  (`scripts/stage.mjs`).

## Addresses

st0 on `127.0.0.1:18789` and pl8 on `127.0.0.1:18795` — **not** the dev session's 8789/8795, so
the app runs beside `npm run dev`. Every service derives a sibling's address from its own, and on
a loopback host that means a PORT table (`servicePorts` in `packages/web-protocol/services.ts`):
the app publishes its pair as `STUDIO_PORTS=st0=18789,pl8=18795`, in the environment its children
inherit — both backends, the file services, the supervisor, whose `Url.cpp` reads the same
variable — and, for the pages, as `__STUDIO_PORTS__` from `src/preload.ts`. A preload rather than a
fetch because the pages compute pl8's address synchronously at import time. Every window gets it,
the ones a page opens included. Opened in an ordinary browser, the same pages would fall back to
8795 and reach the dev pl8.

The ports are fixed, not picked free at each launch: a page's storage and its service worker are
keyed on its ORIGIN, port included, so a moving port would empty both every time.

Unix sockets would not replace them. A page reaches st0 and pl8 through fetch, cookies, CORS and
WebSockets, all of which need an http origin; a custom Electron scheme carries no WebSocket; and
the engine is reached on TCP directly.

Plain http on loopback is enough: `127.0.0.1` is a secure context, and the session cookie is
host-only and `Lax`, which a browser sends across the two ports since a cookie ignores ports.
`COOKIE_DOMAIN` is therefore forced empty — set, it would make the cookie `Secure`.

## Sign-in

No OIDC issuer is configured, which is what selects `@frediverse/oidc`'s DEV AUTH stub: the
window opens on `/auth/login`, which signs in "Dev User" and comes back. The session secret is
generated once and kept in the state folder, shared by both backends.

The stub user has no groups, so **it is never an admin** — it cannot edit the origin's
libraries. The app therefore seeds `libraries.json` itself on first run.

## The library

A project opens only once the origin has a library (`packages/project-shell/docs/launch.md`).
The hub's settings form accepts only SSH git URIs, but the list it READS takes any URI git can
clone, so the app seeds a LOCAL one: the `st0-library` submodule from a checkout, a bare clone of
it inside the packaged app. No network, no deploy key. Delete `workspaces/libraries.json` to
reseed.

## The engine

The supervisor is run the way the tray runs it — no arguments, NDJSON on stdio, stdin held open
for the app's life (`engine/st0-supervisor/docs/hostProtocol.md`). It gets a home of its own and
engine port **8766**, not the tray's `~/.st0` and 8765: the supervisor adopts whatever engine
already listens on its port, and its lock is per home, so the two coexist. Its first run
downloads its sample packs into that home, like any fresh supervisor home.

Quit stops the supervisor first — it deregisters from pl8, which must still be up — then kills
the engine named by its pidfile if it survived, then the backends.

## State

Everything lives under the OS's per-app folder (`~/Library/Application Support/st0-standalone`
on macOS): `workspaces/` (`$STUDIO_FILES_ROOT`), `mediatek/`, `prefs/`, `server-home/`,
`engine-home/`, `session-secret`, and `standalone.log`, the merged log of every process.

## Packaging

`scripts/stage.mjs` builds `staging/`, which the shell's builder config copies into Resources.
The backends' deps are installed with `--ignore-scripts` — the one native addon (ssh2's crypto)
would target the system node's ABI rather than Electron's, and falls back to JS. The build is
unsigned: partially signed, Gatekeeper kills the unsigned children.

External tools stay external, as in pl8's image: `git` (libraries, workspaces), `ffmpeg`,
`yt-dlp`, `mpv` — found on `PATH` or through their `*_BIN` variables.
