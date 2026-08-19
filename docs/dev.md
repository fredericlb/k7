# `npm run dev` — the whole studio in one command

```bash
npm run dev                        # every app + the engine + the tray, under Tilt
npm run dev -- native pl8-frontend # only the named Tilt resources
npm run dev:native                 # only the engine and the tray, no Tilt
npm run vscode                     # the browser editor at /dev, on its own
```

## Where it answers

**`https://st0.priv.frediver.se`** — one origin, one path per service (`/pl8`,
`/k7`, `/z0`), with **l8** answering the root. The same shape production has under
`studio.frediver.se`, which is the point: the two differ by their origin and nothing else.

The hostname is still `st0.…` and does not follow the rename: it is a DNS name in a router,
not a fact this repo owns, and the médiathèque that was `st0` is `pl8` under `/pl8` now.

> **The LAN proxy's path table lives on the other machine.** It is the one piece of this
> topology not versioned here, and it must mirror `apps/studio/docker/nginx.conf`, which is
> versioned. What that file says, as ports:
>
> | path | goes to | |
> |---|---|---|
> | `/` | **5223** | l8's dev server — was 5224 |
> | `/pl8` | **5224** | pl8's dev server — was `/` |
> | `/api/*` | **8789** | l8's backend — the engine registry |
> | `/auth/*` | **8789** | l8's backend — the origin's OIDC flow |
> | `/pl8/api/*` | 8795 | pl8's backend |
>
> **`/auth/*` follows the root**, so it moved to 8789 with everything else. The registered
> `redirect_uri` is `<origin>/auth/callback` and has no prefix, so the flow belongs to whichever
> service answers the root — the médiathèque before, l8 now. The IdP was never touched; only
> the process serving the callback changed.
>
> It briefly did NOT follow: for one release `/auth` stayed on 8795 while l8 already held the
> root. That worked, and it is worth knowing what the wrong half of it looks like, because both
> mistakes are silent in the same way — a backend that mounts no auth routes answers Express's
> own **404, `Cannot GET /auth/login`**, which reads like a broken login rather than a misrouted
> one. Nothing else fails and the SPA still loads; only signing in is impossible.
>
> Routing `/auth` to **5223** instead of 8789 also works: l8's vite config proxies `/auth` to
> its own backend, which is what makes the dev server usable when visited directly on its port.
> 8789 is preferred here, because it is what the production edge does and the two are meant to
> differ by their origin and nothing else.

Nothing on this workstation terminates TLS any more. The name resolves to the **LAN server**,
which reverse-proxies to the dev servers here. So there is no edge to start, no `npm run
caddy`, and no certificate to trust — which is what the old setup cost: `studio.test` was
`127.0.0.1` in every machine's hosts file, fronted by a local Caddy whose `tls internal` CA
each browser had to be told about, and which node never trusted at all.

Two leftovers, both of which end:

- **`studio.test` no longer answers here** — no local Caddy runs any more — but the name
  may linger in hosts files, and the LAN proxy may still forward with `Host: studio.test`.
  Every vite config therefore still accepts that Host — `scripts/dev-hosts.mjs` says why,
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

- **`capot`**, whose `dev` is `tauri dev` — the tool for a human watching a terminal.
  Here it would fight the native monitor for the same single-instance tray.
- **the `apps/<x>` aggregators**, whose `dev` is itself `turbo run dev --filter=…` over
  their own children. Running the parent *and* the children would start every server
  twice.
- **`tsc --noEmit --watch`**, the packages' typecheck watchers. Six more rows for
  feedback each app's own `npm run dev` still gives you.

turbo keeps `build` and `test` — Tilt only owns the dev session.

The **file service** is in the list deliberately. In dev the tray's supervisor does not
spawn one (`fileservice.rs`), because `@studio/file-service`'s own `tsx watch` owns port
8770 and a second would fight it for the port. If the tray comes up before the session
does, the supervisor's file-service watch notices within two seconds and the icon goes
green on its own — no ordering to get right.

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
this ever leaves a dev machine, is a forward-auth rule on the LAN proxy pointed at l8's
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
and why ttyd was rejected — is in [remote.md](remote.md).

## The native task — `scripts/dev-native.mjs`

It is `engine/moteur`'s `dev` script, which is what gives it a pane in the TUI beside the
servers. That it also rebuilds the tray is not a mis-filing: the engine is the reason the
monitor exists — it is the half with no watch mode — and the tray is simply how the
engine is run in dev, since the supervisor inside it is what spawns the binary. `capot`
keeps `tauri dev` for the case that tool is actually good at.

The engine is C++ and the tray is Rust, so neither has a watch mode that means anything:
there is nothing to hot-reload, only a binary to relink and a process to restart. That
is what the monitor does — watch the sources, rebuild, restart:

| target | watched | rebuilt with |
|---|---|---|
| `moteur` | `engine/`, `server/`, `CMakeLists.txt`, `CMakePresets.json` | `npm run build:win` / `build:mac --workspace moteur` |
| `capot` | `src-tauri/src/`, `Cargo.toml`, `build.rs`, `tauri.conf.json` | `build-engine.mjs --dev` |

`engine/moteur/tests/` is deliberately not watched: it links a binary of its own, and
rebuilding it would double the wait for something the tray never runs.

### Why one process owns both watches

**A running image cannot be relinked.** On Windows the file is held open for write, so
cargo's relink against a live tray fails with a confusing linker error, and the engine's
does the same while the supervisor has `studio-moteur.exe` running. The order is
therefore stop → build → start, exactly as `restart-tray.mjs` has always done it.

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

A failed build puts its target back in the dirty set and stops there, leaving the tray
down. It is **not** retried on a timer: a broken build retried every 500 ms is a fan, not
a signal. Save again and it tries again.

At startup the monitor rebuilds the tray unconditionally — a cargo no-op is seconds, and
it is what guarantees `out/dev` matches `src-tauri/src` — but rebuilds the engine only if
there is no binary, or if the sources are newer than the one in `engine/moteur/build`. A
session should not pay a cmake run to be told there is nothing to do, and should not
silently run the engine you had before a `git pull`.

### On exit

The tray is launched **detached** (`start-engine.mjs`), so it outlives the process that
started it. `dev-native.mjs` stops every tray on `SIGINT`/`SIGTERM` and again at startup,
and `dev.mjs` repeats it after Tilt is gone — a resource may be ended too abruptly for
its own handler to run, and an orphaned menu-bar icon with no session to explain it is
the one leak worth being sure about. If one ever escapes anyway:

```bash
npm run tray:stop --workspace capot
```

## Where the steps live

`engine/capot/scripts/trayProcess.mjs` holds the tray's lifetime as functions — `running`,
`stopAll`, `buildDevApp`, `launch` — and `restart-tray.mjs` is now a thin CLI over it.
The one difference from a script is that every step **throws** rather than calling
`process.exit`: a one-shot command turns that into an exit code, and a watcher meant to
outlive a bad build cannot afford either. See
[engine/capot/scripts/docs/restartTray.md](../engine/capot/scripts/docs/restartTray.md) for
what those steps do and why the order is not negotiable.
