# `npm run dev` — the whole studio in one command

```bash
npm run dev                        # every app + the engine + the tray, under Tilt
npm run dev -- native pl8-frontend # only the named Tilt resources
npm run dev:native                 # only the engine and the tray, no Tilt
npm run vscode                     # the browser editor at /dev, on its own
```

## Where it answers

**`https://st0.priv.frediver.se`** — one origin, one path per service (`/pl8`,
`/k7`, `/z0`), with **st0** answering the root. The same shape production has under
`studio.frediver.se`, which is the point: the two differ by their origin and nothing else.

> **The LAN proxy's path table lives on the other machine.** It is the one piece of this
> topology not versioned here, and it must mirror `apps/z0/docker/nginx.conf`, which is
> versioned. What that file says, as ports:
>
> | path | goes to | |
> |---|---|---|
> | `/` | **5223** | st0's dev server |
> | `/pl8` | **5224** | pl8's dev server |
> | `/api/*` | **8789** | st0's backend — the engine registry |
> | `/auth/*` | **8789** | st0's backend — the origin's OIDC flow |
> | `/pl8/api/*` | 8795 | pl8's backend |
> | `/k7` | 5173 | k7's dev server |
> | `/k7/api/*`, `/k7/rtc*` | 8787 | k7's backend — prefix STRIPPED |
> | `/z0/api/*`, `/z0/auth/*`, `/z0/audio/*`, `/z0/ws*` | 8080 | z0's backend — prefix STRIPPED |
> | `/z0/presenter` | 3001 | |
> | `/z0/monitor` | 3002 | |
> | `/z0/buzzer` | 3004 | |
> | `/z0/remote` | 3005 | |
> | `/z0/editor` | 3006 | the `.z0` project editor |
> | `/z0` | 3003 | `z0-online`, the apex — must come LAST of the z0 rules |
>
> The SPA rows are **not** stripped: each vite `base` is the full public path, so the dev
> server has to see it. Only the API rows strip. The table lists every SPA rather than stopping
> at pl8, because a missing row on the other machine is how an address reaches the wrong dev
> server: the proxy matches raw string prefixes, so two SPA paths where one is a prefix of the
> other are routed by whichever rule is listed, and the wrong dev server answers with vite's own
> message about its `base` — which reads like a bad link when the address was correct.
>
> **A prefix is written with or without its trailing slash**, `/pl8` as readily as `/pl8/`, and
> both reach the médiathèque: the bare form redirects to the slashed one, which stays canonical
> because that is what each vite `base` says. `apps/z0/docker/nginx.conf` does it in the image and
> `defineAppConfig` does it on the dev server — `commons/dev/vite-config/docs/base.md`. The rows
> above are raw prefixes, so they already match the bare form on the way in.
>
> **`/auth/*` follows the root**, so it is on 8789 with everything else. The registered
> `redirect_uri` is `<origin>/auth/callback` and has no prefix, so the flow belongs to whichever
> service answers the root, which is st0.
>
> Sending `/auth` to a backend that mounts no auth routes fails silently, and it is worth
> knowing what that looks like: Express answers its own **404, `Cannot GET /auth/login`**, which
> reads like a broken login rather than a misrouted one. Nothing else fails and the SPA still
> loads; only signing in is impossible.
>
> Routing `/auth` to **5223** instead of 8789 also works: st0's vite config proxies `/auth` to
> its own backend, which is what makes the dev server usable when visited directly on its port.
> 8789 is preferred here, because it is what the production edge does and the two are meant to
> differ by their origin and nothing else.

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
  `/dev-status` redirects to `st0.priv.frediver.se:10351`, which does not answer until
  the LAN proxy forwards that port.

The session runs under **[Tilt](https://tilt.dev)**: `npm run dev` is `tilt up --port
10350`, so each dev server is its own restartable resource — status, filterable logs
and a restart button in the web UI at **http://localhost:10350**; from a terminal,
`tilt trigger <resource>` does what the button does. A crash paints one row red instead
of taking the session down, which one TUI process could never do. `dev.mjs` itself adds
only two things: it refuses to start when port 10350 is already held (one session at a
time — a second would fight the first for every dev port), and it stops the detached
tray on the way out. Extra args are handed to `tilt up`, so a resource-name list runs a
subset. The native side is a resource in that list like any other — see below for what
it takes to make it one.

## The task list

`scripts/tilt-tasks.mjs` exists for one reason: to derive the resource list (as JSON,
read by the `Tiltfile`) instead of spelling out seventeen entries, so a new app joins by
existing. It runs over every workspace package that has a `dev` script and drops three
kinds, each for a reason:

- **`st0-tray`**, whose `dev` is `tauri dev` — the tool for a human watching a terminal.
  Here it would fight the native monitor for the same single-instance tray, and its
  `predev` stages a sidecar the monitor has not built yet.
- **the `apps/<x>` aggregators**, whose `dev` is itself a `concurrently` command over
  their own children. Running the parent *and* the children would start every server
  twice.
- **`tsc --noEmit --watch`**, the packages' typecheck watchers. Six more rows for
  feedback each app's own `npm run dev` still gives you.

The root `build` and `test` scripts stay outside this list — Tilt only owns the dev session.

The **file service** is in the list deliberately. In dev the supervisor does not spawn one
(`fileServiceProcess.ts`), because the session's own already owns port 8770 and a second
would fight it for the port. If the app comes up before the session does, the supervisor's
file-service watch notices within two seconds and the settings page goes green on its own —
no ordering to get right. Under WSL that row runs on the **host** rather than in the distro,
which is `scripts/dev-file-service.mjs` and is measured in [wsl.md](wsl.md).

## `claude-rc` — Claude Code's Remote Control, inside the session

`claude rc` (`claude remote-control`) is a `local_resource` in the `tools` label, run at the
repo root: it serves the sessions that claude.ai/code and the phone app drive, in THIS tree.
It is not derived from `tilt-tasks.mjs` — it belongs to no workspace package — so the
`Tiltfile` spells it out beside the loop.

Inside the session rather than a logon task, unlike the editor and the shell: what it drives
is a working tree being edited, so it is worth no more than the session that edits it, and a
row with a restart button is what a re-auth or a dropped socket needs. Losing it costs a door
that was never the way in — `console.priv.frediver.se` still answers.

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
this ever leaves a dev machine, is a forward-auth rule on the LAN proxy pointed at st0's
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

`scripts/dev-hosts.mjs` exports `AUTH_PORT` — st0's backend, which serves `/auth/*` for the WHOLE
origin. It lives there rather than in each vite config because it is the one port a config names
that is **not** its own backend: every SPA on this origin carries one session minted by one
service, and in dev each dev server has to forward `/auth` there itself when it is visited directly
on its port. `defineAppConfig`'s `proxyPaths` cannot express it — that helper points every path at
the caller's `backendPort`, which is right for `/api` and wrong for exactly this one.

Hence one export: a port hand-copied into three vite configs is three places to find the day it
changes.

st0 owns the flow because it is the service with NO path prefix: `redirectUriFor` builds
`<origin>/auth/callback`, and that is the single `redirect_uri` the IdP has registered. See
`packages/web-protocol/services.ts`.

## Under WSL, the native task is bridged

The sources live in the distro and the MSVC toolchain does not, so `dev-native.mjs` hands
itself to `scripts/dev-native-bridge.mjs`, which mirrors the tree onto the host's NTFS and runs
*that same script* there. Nothing below changes — the resource, its logs and its restart button
are where they were. Why a mirror rather than a build over the share, and what the mirror does
and does not carry, is [wsl.md](wsl.md).

## The native task — `scripts/dev-native.mjs`

It is `engine/st0-engine`'s `dev` script, which is what gives it a pane in the TUI beside the
servers. That it also rebuilds the tray is not a mis-filing: the engine is the reason the
monitor exists — it is the half with no watch mode — and the desktop app is simply how the
engine is run in dev, since the supervisor inside it is what spawns the binary.

The engine is C++ and the tray is Rust, so neither has a watch mode that means anything:
there is nothing to hot-reload, only a binary to relink and a process to restart. That is
what the monitor does — watch the sources, rebuild, restart.

| target | watched | rebuilt with |
|---|---|---|
| `moteur` | `engine/`, `server/`, `CMakeLists.txt`, `CMakePresets.json` | `npm run build:win` / `build:mac --workspace st0-engine` |
| `capot` | `src-tauri/src/**.rs`, `Cargo.toml`, `build.rs`, `tauri.conf.json`, `dist/*.{html,css,js}` | `buildDevApp` — `tauri build --debug --no-bundle` into `out/dev` |

The tray's `dist/` is in that list because `tauri build` **embeds** the settings window's page
in the binary: nothing serves it from disk, so editing it is a relink like editing a `.rs`.

A failed build of either half leaves the tray down, and says so — `✖ … the tray is stopped, fix
and save again`. The cycle stops the tray BEFORE building, since a running image cannot be
relinked, and relaunches only once every dirty target has built. The target that failed stays
dirty, so the next save retries it instead of looping on it.

`engine/st0-engine/tests/` is deliberately not watched: it links a binary of its own, and
rebuilding it would double the wait for something the tray never runs.

### Why one process owns both watches

**A running image cannot be relinked.** On Windows the file is held open for write, so
a relink against a live binary fails with a confusing linker error, and the engine's
does the same while the supervisor has `st0-engine.exe` running. The order is
therefore stop → build → start, exactly as `restart-tray.mjs` does it.

And the thing that must be stopped is *the same tray* for both targets: killing it takes
the supervisor, the engine and the file service down with it through the job object. Two
independent watchers would race to stop and restart one process. So there is one, and a
cycle that needs both rebuilds does one stop, both builds, one start.

This is also why the monitor owns the *build* and not just the restart. A watcher that
only reacted to a changed binary could never fire: while the session is up, nothing can
produce that binary.

### The cycle

Saves are debounced 500 ms and coalesced per target. A target is removed from the dirty
set **before** its build, not after, so a save landing mid-build is not swallowed — it
just queues another cycle. A save landing during a build re-arms the timer, which keeps
retrying until the cycle in flight frees the tray.

A failed build puts its target back in the dirty set and stops there, leaving the app
down. It is **not** retried on a timer: a broken build retried every 500 ms is a fan, not
a signal. Save again and it tries again. Only the ENGINE can fail this way now — the app's
build is the `capot` Tilt resource and never leaves anything stopped.

At startup the monitor launches the app unconditionally, and rebuilds the engine only if
there is no binary, or if the sources are newer than the one in `engine/st0-engine/build`. A
session should not pay a cmake run to be told there is nothing to do, and should not
silently run the engine you had before a `git pull`.

### A build that succeeds without replacing the image

MSBuild prints `st0-engine.vcxproj -> …exe` and exits **0** when a running engine holds the
file, so the session would go on running the code you just changed away from. `buildEngine`
therefore checks the binary's mtime afterwards.

The test is deliberately *"is the binary at least as new as its sources"* and **not** *"did it
change"*. A watcher event can fire with nothing actually edited — Windows reports odd names for
changes under the build tree — and a no-op build is then the correct outcome. Demanding a change
turns that harmless case into a hard failure that leaves the tray stopped, which is worse than the
bug being guarded.

The watch roots filter by BASE name, because a recursive `fs.watch` reports a path relative to the
root. Anything unmatched is ignored, which is what keeps the engine's own `build/` output — and
every editor swap file — from triggering a rebuild. The rebuild order is engine first: the tray's
`--dev` build stages nothing from the engine, but building the slow one first means a broken C++
never costs a native build.

### On exit

The tray is launched **detached** (`start-engine.mjs`), so it outlives the process that
started it. `dev-native.mjs` stops every tray on `SIGINT`/`SIGTERM` and again at startup,
and `dev.mjs` repeats it after Tilt is gone — a resource may be ended too abruptly for
its own handler to run, and an orphaned menu-bar icon with no session to explain it is
the one leak worth being sure about. If one ever escapes anyway:

```bash
npm run tray:stop --workspace st0-desktop
```

## Where the steps live

`engine/st0-tray/scripts/trayProcess.mjs` holds the tray's lifetime as functions — `running`,
`stopAll`, `buildDevApp`, `launch` — and `restart-tray.mjs` is a thin CLI over it.
The one difference from a script is that every step **throws** rather than calling
`process.exit`: a one-shot command turns that into an exit code, and a watcher meant to
outlive a bad build cannot afford either. See
[engine/st0-tray/scripts/docs/restartTray.md](../engine/st0-tray/scripts/docs/restartTray.md) for
what those steps do and why the order is not negotiable.
