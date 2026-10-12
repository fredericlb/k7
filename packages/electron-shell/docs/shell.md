# The Electron shell

What a studio desktop app shares: it runs the hosted servers on the musician's machine, unchanged,
behind one window. `apps/st0-standalone` is the app built on it, and its `docs/standalone.md` says
what is particular to it.

| subpath | what it holds |
|---|---|
| `servers` | a server started under tsx with Electron as its node, waited for, stopped |
| `guard` | the entry that leads each server's process group — built beside the main process |
| `log` | one merged log, every line prefixed by who said it |
| `boot` | the ports checked free, the session secret kept across launches |
| `window` | the window, and which links stay in it |
| `lifecycle` | one copy of the app, a boot that reports its failure, a quit that waits |
| `build`, `start`, `builder` | the esbuild bundle, the unpackaged run, the electron-builder base |

## The servers run unchanged

**Under tsx, as children — the way their Docker images run them.** Nothing is bundled, so the
packaged app carries source plus `node_modules`, and a server behaves exactly as it does in
production. The cost is size and that tsx compiles on every start.

**Electron is their node**, through `ELECTRON_RUN_AS_NODE=1`. It is inherited, and that is
load-bearing: a server that spawns with `process.execPath` gets Electron, and only that variable
keeps it node. VS Code's terminals export the same variable, which is why `start` clears it for
the app itself: with it set, Electron opens no window.

**A server's cwd is never a checkout.** `@frediverse/env` reads the nearest `env.yaml` above the
cwd and lets it outrank the environment, so a dev checkout's settings would otherwise win.
`TSX_TSCONFIG_PATH` keeps each server on its own tsconfig.

## Each server dies with the app

**Each server is a process group led by a guard**, stopped as one: a server need not handle any
signal, and what it spawned would outlive it. The guard's stdin is a pipe from the main process
that nothing writes. The OS closes it however that process ends — Quit, a crash, Force Quit,
SIGKILL — and the guard then stops its group.

Stopping from the main process alone is not enough: a main process that dies never runs its
shutdown, and its detached children keep the ports, which the next launch reports as already in
use. A server that exits on its own takes its group with it for the same reason.

**Quit waits for the app's `stop`.** `lifecycle` holds Electron's quit until it resolves, so the
app decides the order its children go down in.

## The window

An app's own pages open as more windows of the app, with the same `webPreferences` — a preload
among them, which a page opened by `window.open` would otherwise not get. Anything else opens in
the system browser, and a navigation away from the app's pages is turned into the same: a
desktop app is not a browser, and has no address bar to come back with.

## Building and packaging

**The main process is bundled to CommonJS**, since Electron's ESM main is awkward around
`__dirname`, which `servers` needs to find the guard. The guard is built beside it, and
**unpacked from the asar**: a child node reads it from disk, and only Electron's own process reads
inside an asar.

**The app's `staging/` is copied into Resources from `afterPack`**, because electron-builder's
`extraResources` silently drops every directory named `node_modules`. `npmRebuild` is off:
nothing native loads in Electron's own process, and the servers' dependencies are staged with
their own install.

**`ELECTRON_DIST=<unpacked dist>`** points electron-builder at an Electron already on disk, for
the machines where its download keeps failing.
