# `npm run dev` — the whole studio in one command

```bash
npm run caddy                 # in another terminal, once — https://studio.test
npm run dev                   # every app + the engine + the tray
npm run dev -- --typecheck    # …and the packages' tsc --watch feedback
npm run dev -- --no-native    # web only: no engine, no tray
npm run dev:native            # only the engine and the tray
```

It is **one** `turbo run dev`, so the session looks like every other `dev` in this repo:
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

## The native task — `scripts/dev-native.mjs`

It is `apps/moteur`'s `dev` script, which is what gives it a pane in the TUI beside the
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

`apps/moteur/tests/` is deliberately not watched: it links a binary of its own, and
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
there is no binary, or if the sources are newer than the one in `apps/moteur/build`. A
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

`apps/capot/scripts/trayProcess.mjs` holds the tray's lifetime as functions — `running`,
`stopAll`, `buildDevApp`, `launch` — and `restart-tray.mjs` is now a thin CLI over it.
The one difference from a script is that every step **throws** rather than calling
`process.exit`: a one-shot command turns that into an exit code, and a watcher meant to
outlive a bad build cannot afford either. See
[apps/capot/scripts/docs/restartTray.md](../apps/capot/scripts/docs/restartTray.md) for
what those steps do and why the order is not negotiable.
