# `npm run dev` — the whole studio in one command

```bash
npm run dev                   # every app + the engine + the tray + the browser editor
npm run dev -- --typecheck    # …and the packages' tsc --watch feedback
npm run dev -- --no-native    # web only: no engine, no tray
npm run dev -- --no-vscode    # without the browser editor at /dev
npm run dev:native            # only the engine and the tray
```

## Where it answers

**`https://st0.priv.frediver.se`** — one origin, one path per service (`/l8`, `/m9`, `/v1`,
`/k7`, `/z0`), with st0 answering the root. The same shape production has under
`studio.frediver.se`, which is the point: the two differ by their origin and nothing else.

Nothing on this workstation terminates TLS any more. The name resolves to the **LAN server**,
which reverse-proxies to the dev servers here. So there is no edge to start, no `npm run
caddy`, and no certificate to trust — which is what the old setup cost: `studio.test` was
`127.0.0.1` in every machine's hosts file, fronted by a local Caddy whose `tls internal` CA
each browser had to be told about, and which node never trusted at all.

Two leftovers, both of which end:

- **`studio.test` still answers**, because a local Caddy may still be running on 127.0.0.1.
  Every vite config therefore still accepts that Host — `scripts/dev-hosts.mjs` says why, and
  a dev server answers **403** to any name not on its list, so that file is what makes the
  studio reachable at all.
- **The Tilt UI has not moved**: it is at `https://studio.test:10351`, and
  `st0.priv.frediver.se:10351` does not answer. `/dev-status` redirects to the latter, so it
  currently leads nowhere.

It is **one** turbo run, so the session looks like every other `dev` in this repo:
turbo.json's `tui`, tasks on the left, the focused task's log on the right. The native
side is a task in that list like any other — see below for what it takes to make it one.

## The filter list

`scripts/dev.mjs` exists for one reason: to derive the filters instead of spelling out
seventeen of them, so a new app joins by existing. It runs over every workspace package
that has a `dev` script and drops three kinds, each for a reason:

- **`capot`**, whose `dev` is `tauri dev` — the tool for a human watching a terminal.
  Here it would fight the native monitor for the same single-instance tray.
- **the `apps/<x>` aggregators**, whose `dev` is itself `turbo run dev --filter=…` over
  their own children. Turbo would run the parent *and* the children, starting every
  server twice.
- **`tsc --noEmit --watch`**, the packages' typecheck watchers. Six more panes for
  feedback each app's own `npm run dev` still gives you, so they are behind
  `--typecheck`.

The **file service** is in the list deliberately. In dev the tray's supervisor does not
spawn one (`fileservice.rs`), because `@studio/file-service`'s own `tsx watch` owns port
8770 and a second would fight it for the port. If the tray comes up before turbo does,
the supervisor's file-service watch notices within two seconds and the icon goes green
on its own — no ordering to get right.

## The browser editor — a ROOT task in the session

`npm run dev` also starts VS Code in the browser at **https://st0.priv.frediver.se/dev**, and it is
the one task that does not arrive through the filter list. It cannot: `workspacePackages()`
reads the `workspaces` globs and the root is not one of them, so a `//#…` task is
unreachable by any `--filter=<package>`. `dev.mjs` therefore names it outright:

```
turbo run dev vscode --filter=<each app> … --filter=//
```

Two task names, and `//` (the root package) added to the filters. This does **not** recurse
back into `npm run dev`, even though the root's own `dev` script is this file: turbo runs
only tasks it has a definition for, and there is no `//#dev` in `turbo.json` — only
`//#vscode`. Check it with `turbo run dev vscode --dry` before changing any of it.

```bash
npm run dev                   # …including the editor
npm run dev -- --no-vscode    # without it (a fresh clone pays a ~100 MB download once)
npm run vscode                # just the editor
```

`storybook` is the other root task (`npm run storybook`, :6006) and is deliberately *not*
joined this way — it is a gallery you open on purpose, not something to have running.

### How the editor task works

`scripts/vscode.mjs` runs the `code serve-web` that ships with VS Code 1.82+, so there is
nothing to install and no `code-server` (which on Windows means WSL). Two flags carry the
whole integration:

- `--server-base-path /dev`, so the proxy's `/dev` route does **not** strip the prefix — the
  same asymmetry the SPAs need, and for the same reason: the server must keep seeing the
  prefix it serves its assets under, while an API route must not.
- `--without-connection-token`, so `https://st0.priv.frediver.se/dev` opens with no handshake.

**No auth is a decision, and worth stating plainly** so nobody "fixes" it by accident or
copies the pattern somewhere it does not belong. What is served is the repo root *with a
terminal*: anyone who can reach `st0.priv.frediver.se` gets a shell on this machine. That is
accepted here — a dev-only config on an open-source repo — and nowhere else.
`--host 127.0.0.1` still stands, because it costs nothing and keeps the proxy the only door.

To put auth back, swap `--without-connection-token` for `--connection-token-file <path>`.
`serve-web` then answers `403` to a bare `/dev` and expects the `?tkn=…` URL it prints
once; it trades that for a `vscode-tkn` cookie good for seven days. The stronger option, if
this ever leaves a dev machine, is a forward-auth rule on the LAN proxy pointed at st0's
backend (which owns `/auth`) so the studio session gates it.

The first run downloads a server build (~100 MB) and answers `202` with a self-reloading
"please wait" page until it is done.

A busy port is reported and treated as **success**. `serve-web` exits 0 when it cannot
bind, so the script checks the port itself — but inside `npm run dev` an editor already
serving that URL is the goal met, and failing there would paint one task red in a session
that is otherwise fine. The case worth knowing: a killed `serve-web` leaves a child holding
the socket, so the port can be busy with nothing useful behind it. The message says as
much, and `Get-NetTCPConnection -LocalPort 8798` finds the process tree to stop.

The busy-port-is-success rule is also what lets the **`studio-vscode` logon task** own
this same editor when the remote layer is installed (see below): whichever of the two
starts first serves, and the other says so and goes green.

## Working remotely — Tilt, `/console` and the logon tasks

An editor that is a task inside `npm run dev` dies with it, which remotely means losing
the only door at the exact moment you need it. `npm run remote:install` inverts that:
three Windows logon tasks bring up the editor, the **dev session under Tilt**
(each server its own restartable resource, web UI still at **https://studio.test:10351** —
**/dev-status** redirects to the new name, which does not answer on that port yet —
`Tiltfile` derived from the same workspace rules as this file's filter list) and a
**shared shell** at **https://st0.priv.frediver.se/console**. While `studio-tilt` runs, do
**not** also run `npm run dev` in a terminal: the session already exists, and a second
would fight it for every port. The whole design — and why ttyd was rejected — is in
[remote.md](remote.md).

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
and `dev.mjs` repeats it after turbo is gone — the TUI may end a task too abruptly for
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
