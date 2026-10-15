# `npm run dev` — the whole studio in one command

```bash
npm run dev                        # every app + the engine, under Tilt
npm run dev -- native k7-frontend # only the named Tilt resources
npm run dev:native                 # only the engine, no Tilt
npm run vscode                     # the browser editor at /dev, on its own
```

## Where it answers

**Three hosts** — `priv.st0.app` (k7 with its media library and its rehearsal pages), and `play.priv.st0.app` and `k7.priv.st0.app`, aliases of k7 as `play.st0.app` and
`k7.st0.app` are in production — `scripts/dev-hosts.mjs` names all three (`DEV_HOST`,
`ALIAS_DEV_HOST`, `K7_ALIAS_DEV_HOST`). The same shape production has under `st0.app` / `play.st0.app` /
`k7.st0.app`, which is the point: the two differ by their domain and nothing else.

> **The LAN proxy's host table lives on the other machine.** It is the one piece of this
> topology not versioned here. What it needs to hold, as ports:
>
> | host | goes to | |
> |---|---|---|
> | `priv.st0.app` | **5223** | k7's dev server |
> | `play.priv.st0.app` | **5223** | k7's dev server, which answers the alias as the hosted k7 does |
> | `k7.priv.st0.app` | **5223** | k7's dev server, the same way |
>
> That is the WHOLE table for k7: its vite dev server already proxies
> `/api`, `/auth` and `/rtc` (the rehearsal pages' phone microphone) to its backend port internally
> (`commons/dev/vite-config/src/index.ts`'s `defineAppConfig` — `backendPort` +
> `proxyPaths`/`wsPaths`), so the LAN proxy only has to get a request to the right HOST. `/z0` on
> `priv.st0.app` belongs to z0's own repository, whose dev servers `npm run dev` here does not start;
> its per-path rules are that repository's to document.
>
> **`/auth/*` follows k7**, wherever the request lands: the registered `redirect_uri` is
> `<origin>/auth/callback` with no prefix, so the flow belongs to whichever service answers a
> bare origin root — k7.
>
> Sending `/auth` to a backend that mounts no auth routes fails silently, and it is worth
> knowing what that looks like: Express answers its own **404, `Cannot GET /auth/login`**, which
> reads like a broken login rather than a misrouted one. Nothing else fails and the SPA still
> loads; only signing in is impossible. A **404 on every route**, `/auth` included, instead
> means the LAN proxy has no rule for the host at all — check that table above before the
> backend.

Nothing on this workstation terminates TLS. The name resolves to the **LAN server**,
which reverse-proxies to the dev servers here. So there is no edge to start, no `npm run
caddy`, and no certificate to trust.

Two things about names and ports:

- **`studio.test` is accepted as a Host beside the real name** — it may linger in hosts files,
  and the LAN proxy may forward with `Host: studio.test`.
  Every vite config therefore accepts it — `scripts/dev-hosts.mjs` says why,
  and a dev server answers **403** to any name not on its list, so that file is what makes
  the studio reachable at all.
- **The Tilt UI is local only**: `http://localhost:10350` on the workstation.
  `/dev-status` redirects to `priv.st0.app:10351`, which does not answer until
  the LAN proxy forwards that port.

The session runs under **[Tilt](https://tilt.dev)**: `npm run dev` is `tilt up --port
10350`, so each dev server is its own restartable resource — status, filterable logs
and a restart button in the web UI at **http://localhost:10350**; from a terminal,
`tilt trigger <resource>` does what the button does. A crash paints one row red instead
of taking the session down, which one TUI process could never do. `dev.mjs` itself adds
only two things: it refuses to start when port 10350 is already held (one session at a
time — a second would fight the first for every dev port), and it stops the engine on
the way out. Extra args are handed to `tilt up`, so a resource-name list runs a
subset. The native side is a resource in that list like any other — see below for what
it takes to make it one.

## Signing in is real OIDC, as in production

`env.yaml` gives the dev session the same provider production has, under `common`, and a
`SESSION_SECRET` of at least 32 characters, so k7's backend starts exactly as it does hosted. A
machine with no OIDC client of its own sets `STUDIO_DEV_AUTH: "1"` in the `k7-backend` section
instead, which runs the "Dev User" stub; without either, the backend refuses to start
(`apps/k7/backend/docs/hardening.md`). Neither the `Tiltfile` nor any script sets that flag.

## The task list

`scripts/tilt-tasks.mjs` exists for one reason: to derive the resource list (as JSON,
read by the `Tiltfile`) instead of spelling out seventeen entries, so a new app joins by
existing. It runs over every workspace package that has a `dev` script and drops two
kinds, each for a reason:

- **the `apps/<x>` aggregators**, whose `dev` is itself a `concurrently` command over
  their own children. Running the parent *and* the children would start every server
  twice.
- **`tsc --noEmit --watch`**, the packages' typecheck watchers. Six more rows for
  feedback each app's own `npm run dev` still gives you.

The root `build` and `test` scripts stay outside this list — Tilt only owns the dev session.

The **file service** is not a row: k7's backend's file hub starts one per account on first use
(`packages/file-hub/docs/fileHub.md`). `k7-backend`'s dev script sets `STUDIO_FILES_WATCH=1`,
and the hub then watches the file service and every `@studio/*` package it runs: an edit stops
the account processes and the next request starts them on the new code.

## The browser editor — outside the session, on purpose

VS Code in the browser at **https://code.priv.frediver.se** (its own origin, opening on
the user's home, terminal defaulting to Git Bash)
is *not* a resource in the dev session: an editor inside the session dies with it,
which remotely means losing the only door at the exact moment you need it. On the dev
box it is the **`studio-vscode` logon task** (see [remote.md](remote.md)); anywhere
else, `npm run vscode` starts it alone. `storybook` (`npm run storybook`, :6006) is
likewise its own command — a gallery you open on purpose, not something to have
running.

### How the editor task works

`scripts/vscode.mjs` runs the `code serve-web` that ships with VS Code 1.82+, so there is
nothing to install and no `code-server` (which on Windows means WSL). Two flags carry the
whole integration:

- `--default-folder`, pointed at the **user's home** — and the integrated terminal
  defaults to **Git Bash**, which the script pins in the server's Machine settings
  (`~/.vscode-server/data/Machine/settings.json`, merged, never overwritten). No
  `--server-base-path`: `code.priv.frediver.se` is a whole origin, so the server serves
  at `/` and the proxy strips nothing.
- `--without-connection-token`, so `https://code.priv.frediver.se` opens with no handshake.

**No auth is a decision, and worth stating plainly** so nobody "fixes" it by accident or
copies the pattern somewhere it does not belong. What is served is a browsable filesystem
*with a terminal*: anyone who can reach `code.priv.frediver.se` gets a shell on this machine. That is
accepted here — a dev-only config on an open-source repo — and nowhere else.
`--host 0.0.0.0`, because the LAN proxy (traefik) is another machine and reaches this
port over the network; the LAN is the trust boundary.

To put auth back, swap `--without-connection-token` for `--connection-token-file <path>`.
`serve-web` then answers `403` to a bare `code.priv.frediver.se` and expects the `?tkn=…` URL it prints
once; it trades that for a `vscode-tkn` cookie good for seven days. The stronger option, if
this ever leaves a dev machine, is a forward-auth rule on the LAN proxy pointed at k7's
backend (which owns `/auth`) so the studio session gates it.

The first run downloads a server build (~100 MB) and answers `202` with a self-reloading
"please wait" page until it is done.

A busy port is reported and treated as **success**. `serve-web` exits 0 when it cannot
bind, so the script checks the port itself — and an editor already serving that URL is
the goal met, which is what lets the **`studio-vscode` logon task** and a by-hand
`npm run vscode` coexist: whichever starts first serves, and the other says so and
exits clean. The case worth knowing: a killed `serve-web` leaves a child holding the
socket, so the port can be busy with nothing useful behind it. The message says as
much, and `Get-NetTCPConnection -LocalPort 8798` finds the process tree to stop.

## Working remotely — `code.priv.frediver.se`, `console.priv.frediver.se` and the logon tasks

The dev session is something you start and stop; the *door* must not be. `npm run
remote:install` registers two Windows logon tasks that survive the session: the
**browser editor** at **https://code.priv.frediver.se** and the **shared shell** at
**https://console.priv.frediver.se** — where `npm run dev` is typically launched when working
remotely. Both are their own origins, routed by hostname on the LAN proxy, and both
start in the **user's home** with Git Bash as the default shell. The whole design —
and why ttyd is not the answer — is in [remote.md](remote.md).

## A NEW `exports` subpath needs the dev server restarted

Every `@studio/*` package is consumed as raw source through `package.json` `exports` subpaths, so
adding a module usually means adding a line there too. Vite resolves those once and caches it:
until the dev server is restarted, the new subpath fails with

```
"./takeClock" is not exported under the conditions ["module", "browser", "development", "import"]
```

which names `node_modules/@studio/<pkg>/package.json` and so reads as a stale install or a broken
symlink. It is neither — the symlink points at the workspace and the field is already there. Save
does not fix it and neither does an HMR round; `tilt trigger <resource>` does. Editing an existing
subpath's file needs none of this: it is the exports MAP being new that the cache is holding.

## One port every config names that is not its own

`scripts/dev-hosts.mjs` exports `AUTH_PORT` — k7's backend, which serves `/auth/*` for the WHOLE
origin. It lives there rather than in each vite config because it is the one port a config names
that is **not** its own backend: every SPA on this origin carries one session minted by one
service, and in dev each dev server has to forward `/auth` there itself when it is visited directly
on its port. `defineAppConfig`'s `proxyPaths` cannot express it — that helper points every path at
the caller's `backendPort`, which is right for `/api` and wrong for exactly this one.

Hence one export: a port hand-copied into three vite configs is three places to find the day it
changes.

k7 owns the flow because it is the service with NO path prefix: `redirectUriFor` builds
`<origin>/auth/callback`, and that is the single `redirect_uri` the IdP has registered. See
`packages/web-protocol/services.ts`.

## The native task — `scripts/dev-native.mjs`

It is `engine/k7-runtime`'s `dev` script, which is what gives it a pane in the TUI beside the
servers. It builds the engine and the supervisor, and runs the supervisor as the command-line engine
— `k7-supervisor --config <state>/engine-host.json` (`engine/scripts/devEngine.mjs`), the settings
file a desktop install keeps, created as `{}` when absent so the studio comes from
`$STUDIO_REGISTRY_URL`. Edit that file to point the dev engine elsewhere; the supervisor never writes
it back.

The engine is C++, so it has no watch mode that means anything: there is nothing to
hot-reload, only a binary to relink and a process to restart — and the supervisor has to be stopped
for that relink, since it holds the engine running. That is what the monitor does — watch
the sources, rebuild, restart.

| target | watched | rebuilt with |
|---|---|---|
| `k7-runtime` | `engine/`, `server/`, `CMakeLists.txt`, `CMakePresets.json` | `npm run build:win` / `build:mac --workspace k7-runtime` |
| `k7-supervisor` | `src/`, `CMakeLists.txt`, `CMakePresets.json` | `supervisorBuild.mjs` |

A failed build of either half leaves the engine down, and says so — `✖ … the engine is stopped, fix
and save again`. The cycle stops the supervisor and the engine BEFORE building, since a running image
cannot be relinked, and starts the supervisor again only once every dirty target has built. The
target that failed stays dirty, so the next save retries it instead of looping on it.

`engine/k7-runtime/tests/` is deliberately not watched: it links a binary of its own, and
rebuilding it would double the wait for something the session never runs.

### Why one process owns both watches

**A running image cannot be relinked.** On Windows the file is held open for write, so
a relink against a live binary fails with a confusing linker error, and the engine's
does the same while the supervisor has `k7-runtime.exe` running. The order is
therefore stop → build → start.

And the processes that must be stopped are *the same* for both targets: the supervisor holds the
engine, so stopping one without the other leaves a binary held. Two independent watchers would race
to stop and restart one pair. So there is one, and a cycle that needs both rebuilds does one stop,
both builds, one start.

This is also why the monitor owns the *build* and not just the restart. A watcher that
only reacted to a changed binary could never fire: while the session is up, nothing can
produce that binary.

### The cycle

Saves are debounced 500 ms and coalesced per target. A target is removed from the dirty
set **before** its build, not after, so a save landing mid-build is not swallowed — it
just queues another cycle. A save landing during a build re-arms the timer, which keeps
retrying until the cycle in flight frees the engine.

A failed build puts its target back in the dirty set and stops there, leaving the engine
down. It is **not** retried on a timer: a broken build retried every 500 ms is a fan, not
a signal. Save again and it tries again.

At startup the monitor rebuilds the engine only if there is no binary, or if the sources are newer
than the one in `engine/k7-runtime/build`, and the supervisor likewise; then it starts the supervisor
whatever was rebuilt. A session should not pay a cmake run to be told there is nothing to do, and
should not silently run the engine you had before a `git pull`.

### A build that succeeds without replacing the image

MSBuild prints `k7-runtime.vcxproj -> …exe` and exits **0** when a running engine holds the
file, so the session would go on running the code you just changed away from. `buildEngine`
therefore checks the binary's mtime afterwards.

The test is deliberately *"is the binary at least as new as its sources"* and **not** *"did it
change"*. A watcher event can fire with nothing actually edited — Windows reports odd names for
changes under the build tree — and a no-op build is then the correct outcome. Demanding a change
turns that harmless case into a hard failure that leaves the engine stopped, which is worse than the
bug being guarded.

The watch roots filter by BASE name, because a recursive `fs.watch` reports a path relative to the
root. Anything unmatched is ignored, which is what keeps the engine's own `build/` output — and
every editor swap file — from triggering a rebuild. The rebuild order is engine first: building the
slow one first means a broken engine never costs a supervisor rebuild.

### On exit

The supervisor is the monitor's child, but in config mode nothing ties its life to the monitor's: it
stops on a signal, not when a pipe closes. So `dev-native.mjs` stops every supervisor and engine on
`SIGINT`/`SIGTERM` and again at startup, and `dev.mjs` repeats it after Tilt is gone — a resource may
be ended too abruptly for its own handler to run, and an engine left holding its port and its binary
is the one leak worth being sure about. Every step **throws** rather than calling `process.exit`, so
a watcher meant to outlive a bad build survives one.
