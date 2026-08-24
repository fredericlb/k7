# The tray app

## Names, and the three this rename did NOT touch

The binary and the displayed name are `studio-capot`; the engine it supervises is
`studio-moteur`. That covers the Cargo package, Tauri's `productName`, the tray tooltip,
the Quit item and the AppleScript dialog titles.

Three names stayed, each for a reason worth more than consistency:

* **`org.parapluie.studio.engine-tray`**, the bundle identifier. On macOS this is the app's
  *identity*: changing it makes the OS treat the build as a different application, dropping
  its microphone and automation (TCC) grants and its login item while leaving the old one
  registered. It is also what Tauri keys single-instance on, so a mid-flight change means
  two trays can run at once. Its own migration, not a side effect of a rename.
* **`~/.studio/engine-tray.json`**, the supervisor's settings. Renaming the file discards
  every existing user's audio-device pick and registry override. Read-old/write-new, or
  not at all.
* **`~/.studio/.studio-engine.log`**, and the `STUDIO_*` environment variables, and
  `x-studio-engine-token`. All part of the `~/.studio` contract, which the plan keeps as a
  separate change for the same reason: a partial landing destroys user data.

The pattern: a *build artifact* can be renamed in one commit because the next build
replaces it. A name the user's disk or the OS remembers cannot.

---

`studio-capot` is a tray-only Tauri app with no window. It is the **VIEW** over the
supervisor (`@studio/engine-host`), which it spawns as a child and drives over NDJSON on
stdio: the supervisor owns the `~/.studio` contract, the registry, and — stage by stage —
the engine and the file service. The tray renders its snapshots and sends its clicks back.

Nothing in `tray.rs` opens a socket, spawns a process or reads a state file. What to allow,
which engine is running, what the ports are, where to heartbeat: all of it comes down in a
snapshot (`host.rs`), and a click goes back up as a command.

## "Sessions ▸" — what the status line could never say

One engine now holds several projects at once, one per app driving it. The status line
reports the PROCESS (`● Running · id 3f2a91c4 · :8765`), and that read the same whether the
engine held nothing, held st0' song, or held a song and a deck and a module preview
together. The submenu is the only place the tray answers *what is my engine doing, and for
whom*:

```
Sessions ▸  st0 · ma-chanson · 4 tracks  ▶  ♫1   ✕
            st0 · le-set · 1 track               ✕
            pl8 · nothing loaded                 ✕
```

`▶` means that session's transport is rolling; `♫n` means n sockets are subscribed to its
audio — someone is listening over the network. Both are shown only when true: a column of
`▶ no · 0 listening` would bury the one session that *is* playing among the ones that are
not.

Clicking a row **drops** that session — its edit, plugins, meters and broadcast tap. The row
*is* the drop, and the `✕` says so; there is no other click on a session row it could be
confused with. The app driving it is not told, and will simply find an empty project.

Gated on `sessionsSig` like the audio and plugin submenus, and for a sharper reason here:
the playhead moves 20 times a second, so a signature built from the whole snapshot would put
the frame on the wire — and tear down a submenu the user has open — at frame rate. The
signature is built from what the rows *show*.

## Safety rule: never kill someone else's engine

Stop and Restart are enabled **only** when the supervisor OWNS the running engine. An
adopted (foreign) engine shows as Running with those items greyed out, so this app can
never kill a process another owner manages — see `AppState::owns_running`.

## The Windows job object (`job.rs`)

The graceful path (`cleanup_async`) stops the engine and file service when the user picks
Quit, but nothing runs when the tray is force-killed or crashes — and its children would
then orphan and keep the engine and file ports bound.

A job object closes that gap. Every process the tray spawns is assigned to one job whose
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag terminates all members when the last handle to
the job closes, and the OS closes our handles when the tray ends however it ends. It also
subsumes the grandchild problem for free: a process created *by* a job member joins the job
automatically, so the `tsx`-forked file-service node is covered with no tree walking.

This is why the job is created in `main.rs` **before anything is spawned** — membership is
inherited, so a force-killed tray takes the whole stack with it. Off Windows the closing
stdin pipe plays the same role.

## Quitting

On quit the supervisor does the actual work: deregister from the registry (while the engine
is still up and the entry still means something), then stop the file service and the
engine, foreign or not — closing the app is terminal, and an engine left listening holds
the audio device and both ports.

`pidkill.rs` is the second half of that sentence, and runs after the supervisor on the way
out for the case where it never got there: it hung on an unresponsive registry and was
killed past its deadline, or it had already crashed when the user quit. An engine that
survives the app is not just untidy — the NEXT launch adopts a process nobody is
supervising. The pidfile is the contract both sides already agree on (see
`engineDaemon.ts`), which is why this needs nothing else to work.

Signals get the same treatment as menu Quit: launchd sends SIGTERM to stop a LaunchAgent
(autostart), and a Ctrl-C in dev should deregister and stop the owned engine too.

## State (`state.rs`)

Two halves, and the split is the whole point:

- **`snapshot`** is what the SUPERVISOR reported. The engine, the file service, the
  identity, the ports, the registry, the audio picks, the allowlist — none of it is
  computed or written here. It arrives whole and replaces what was.
- **everything else** is view state the tray genuinely owns, and there is very little left:
  the spinner frame, the menu-bar darkness, the menu handles, and the two signatures
  recording what the submenus were last *drawn* from (the supervisor computes the
  signatures; these are the tray's memory of which one it rendered).

## The remaining loops (`supervisor.rs`)

The name is a misnomer — the supervisor is `@studio/engine-host`. The registry heartbeat,
the refused-origin poll, the crash watch, the file-service watch and all three engine-query
polls belong to it: it owns those files, those processes, and the one connection to the
engine.

Two loops live here, and both are genuinely view work:

- `spinner_loop` runs at 8 frames per second. Putting that on the pipe would turn an idle
  app into a constant stream of messages to redraw one glyph — exactly the cost the
  snapshot design exists to avoid.
- `appearance_loop` re-reads the menu bar's light/dark, which nothing pushes to us.

Every loop snapshots the state under a short lock and **drops the guard before any
`.await`**: a std `Mutex` must never be held across an await point.

## Paths (`paths.rs`)

The layout is defined by `packages/engine-client/src/paths.ts`, not here. The three paths the
tray opens for the user (workspaces root, merged log, origins file) arrive in the supervisor's
snapshot rather than being recomputed. What is left belongs to subsystems the tray has not
handed over yet, and goes with them.

## Finding the supervisor (`hostcmd.rs`)

The tray answers one question — "what do I exec?" — in three tiers, and says clearly when
the answer is "nothing", because a tray that silently supervises nothing looks exactly like
a healthy one:

1. **`$STUDIO_ENGINE_HOST_CMD`** — an executable run with no arguments. The escape hatch
   for testing a custom supervisor build.
2. **Packaged** — the vendored `node` beside our executable, running the esbuild'd
   `engine-host.mjs` from the app's resources. Nothing on PATH, no repo needed.
3. **Dev** — `node` from PATH running the repo's `tsx` CLI on the TypeScript source, so
   `npm run engine:dev` supervises with no build step.

Tier 3 exists only because `buildDevApp()` deliberately ships an app with an empty
`resources` list; that is what makes a dev build take this path rather than a stale bundle.

## The link itself (`host.rs`)

One JSON object per line: snapshots and notifications come up on the supervisor's stdout,
commands go down its stdin. The written definition of the format is
`packages/engine-host/src/hostProtocol.ts`; the structs in `host.rs` are its hand-written
Rust mirror — the same arrangement `engine-protocol` has with the C++ engine.

It is deliberately **partial**: only the fields the tray consumes are mirrored. serde
ignores the rest, so a snapshot field belonging to a subsystem the tray does not own simply
does not appear — and adding one is how a later stage takes it over.

The supervisor is spawned into the kill-on-close job, which makes it (and everything it
comes to own) die with the tray on Windows however the tray ends; on Unix the pipe does the
same. A supervisor that crashes is relaunched with 1s→30s backoff, and the engine survives
that because the pidfile lets the fresh supervisor re-adopt it.

## The merged log (`logbus.rs`)

`~/.studio/.studio.log` is written by the supervisor, which owns the engine and the
file service and pumps both into it. Two jobs are left on the tray side:

1. **Truncate it once, at startup.** The tray's lifetime is what "a session" means, and it
   is the only process that knows a session began: the supervisor can be relaunched
   mid-session after a crash, and truncating there would wipe the log the user is reading
   to find out why it crashed.
2. **Write the `[host]` lines** — the supervisor's own stderr, plus the tray's notes about
   starting and losing it. These are what remain when the supervisor is the thing that
   broke, so they cannot live in the supervisor.

Both writers open in APPEND mode after the truncate. A single append-mode write is atomic
on both platforms, so whole lines interleave rather than tearing.
