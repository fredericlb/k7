# What starts, and what stops it

## Names, and the three this rename did NOT touch

The binary and the displayed name are `studio-capot`; the engine it supervises is
`studio-moteur`. That covers the npm package, electron-builder's `productName`, the tooltip,
the Quit item and the AppleScript dialog titles.

Three names stayed, each for a reason worth more than consistency:

* **`org.parapluie.studio.engine-tray`**, the bundle identifier. On macOS this is the app's
  *identity*: changing it makes the OS treat the build as a different application, dropping
  its microphone and automation (TCC) grants and its login item while leaving the old one
  registered. It is also what `requestSingleInstanceLock` keys on, so a mid-flight change means
  two trays can run at once. Its own migration, not a side effect of a rename.
* **`~/.studio/engine-tray.json`**, the supervisor's settings. Renaming the file discards
  every existing user's audio-device pick and registry override. Read-old/write-new, or
  not at all.
* **`~/.studio/.studio-engine.log`**, and the `STUDIO_*` environment variables, and
  `x-studio-engine-token`. All part of the `~/.studio` contract, which the plan keeps as a
  separate change for the same reason: a partial landing destroys user data.

The pattern: a *build artifact* can be renamed in one commit because the next build
replaces it. A name the user's disk or the OS remembers cannot.

## Running it at all: `npm run app:setup`

`electron@44` declares **no scripts**, so `npm install` never fetches its runtime and
`node_modules/electron/dist` simply never appears. Nothing says so: what you get is `spawn
ENOENT` on a path that looks installed, which reads as a corrupt tree rather than a missing
step. `scripts/fetch-electron.mjs` is that step, idempotent, and `start-engine.mjs` and both
spikes check for it and name it rather than failing raw.

Under WSL it is needed **twice** — once in the distro and once in the mirror
(`C:\studio-native`), which keeps its own `node_modules` and is where the app actually runs.

---

`studio-capot` is an ordinary windowed app. It is the **VIEW** over the
supervisor (`@studio/engine-host`), which it spawns as a child and drives over NDJSON on
stdio: the supervisor owns the `~/.studio` contract, the registry, and — stage by stage —
the engine and the file service. The app renders its snapshots and sends its clicks back.

Nothing in this app opens a socket, spawns a process or reads a state file. What to allow,
which engine is running, what the ports are, where to heartbeat: all of it comes down in a
snapshot (`host.ts`), and a click goes back up as a command.

## The window IS the app

Opening it starts the supervisor, which starts the engine and the file service. Closing the
last one stops all three: `window-all-closed` quits, and `before-quit` does the teardown in
order — supervisor first (its exit is what DEREGISTERS, and that wants to happen while the
engine is still up and the entry still means something), then `pidkill`'s backstop for the case
where it never got there.

There is no tray and nothing runs on behind the window. That is a deliberate simplification of
what this was, and it has two consequences worth stating rather than discovering:

- **A second device loses the engine when you close the window here.** While the window is
  open, `/external` on a tablet works exactly as before; when it closes, the engine goes with
  it. The LAN address stops answering, not just the surface.
- **A browser using this machine's engine loses it too.** The app still registers with a
  configured server, so a hosted st0 can pick this engine — for as long as the window is open.

Whoever wants an engine with no window runs **`studio-engine`**, the same `startSupervisor`
with a terminal in front of it. `~/.studio/engine-host.pid` keeps the two from running at once:
the second refuses and names the first, which is what stops one stopping the other's engine.

## Safety rule: never kill someone else's engine

Stop and Restart are enabled **only** when the supervisor OWNS the running engine. An
adopted (foreign) engine shows as Running with those items greyed out, so this app can
never kill a process another owner manages — `ownsEngine` in the snapshot is the flag, and
`engineActions` in st0's settings page is what reads it.

## The Windows job object (`job.ts`)

The graceful path stops the engine and file service when the user closes the window, but
nothing runs when the app is force-killed or crashes — and its children would then orphan and
keep the engine and file ports bound.

A job object closes that gap. Every process the app spawns is assigned to one job whose
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag terminates all members when the last handle to
the job closes, and the OS closes our handles when the app ends however it ends. It also
subsumes the grandchild problem for free: a process created *by* a job member joins the job
automatically, so the `tsx`-forked file-service node is covered with no tree walking.

This is why the job is created at the top of `whenReady()` **before anything is spawned** —
membership is inherited, so a force-killed app takes the whole stack with it. Off Windows the
closing stdin pipe plays the same role.

**The three Win32 calls go through `koffi`**, an `optionalDependency` loaded lazily on win32
only. That is the answer to a question the port had to settle out loud: not an in-repo N-API
addon, which Electron would load against its own ABI and so would need `electron-rebuild`;
not a PowerShell handle-holder, a permanent extra process for one call. koffi is Node-API, so
its prebuilds are ABI-stable across Node and Electron and ship inside the tarball. A
nested-job failure degrades rather than throws, logged once as
`[host] no kill-on-close job (nested job?)` so reduced coverage is visible rather than
assumed.

**Measured, 2026-08-30, Windows:** `npm run app:spike-job -w studio-desktop` force-kills an
Electron victim with `taskkill /F` and asserts the grandchild went with it — it passes. The
spike checks the grandchild was actually alive first, because the cheap version of this test
passes just as well when nothing ever started. So the containment is the job, not `pidkill`
alone; `pidkill` runs on the graceful path only.

## Quitting

On quit the supervisor does the actual work: deregister from the registry (while the engine
is still up and the entry still means something), then stop the file service and the
engine, foreign or not — closing the app is terminal, and an engine left listening holds
the audio device and both ports.

`pidkill.ts` is the second half of that sentence, and runs after the supervisor on the way
out for the case where it never got there: it hung on an unresponsive registry and was
killed past its deadline, or it had already crashed when the user quit. An engine that
survives the app is not just untidy — the NEXT launch adopts a process nobody is
supervising. The pidfile is the contract both sides already agree on (see
`engineDaemon.ts`), which is why this needs nothing else to work.

Signals get the same treatment as closing the window: launchd sends SIGTERM to stop a LaunchAgent
(autostart), and a Ctrl-C in dev should deregister and stop the owned engine too.

## Finding the supervisor (`hostCmd.ts`)

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

## The link itself (`host.ts`)

One JSON object per line: snapshots and notifications come up on the supervisor's stdout,
commands go down its stdin. The written definition of the format is
`packages/engine-host/src/hostProtocol.ts`, and `host.ts` IMPORTS it — there is no mirror at
all, which is what the port to Electron bought: the hand-written Rust `Snapshot` that had to
be kept in step is simply gone. (The C++
engine still mirrors `engine-protocol` by hand, and still has to.)

The app reads only the fields it draws and ignores the rest, exactly as the partial serde
mirror did — but now by not referencing them, rather than by omitting them from a second
declaration that could drift.

The supervisor is spawned into the kill-on-close job, which makes it (and everything it
comes to own) die with the tray on Windows however the tray ends; on Unix the pipe does the
same. A supervisor that crashes is relaunched with 1s→30s backoff, and the engine survives
that because the pidfile lets the fresh supervisor re-adopt it.

## The merged log (`logbus.ts`)

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

## The icon is st0's own

The old one was DRAWN, four states with a spinner, because a menu-bar item had only a glyph to
say whether an engine was running. A windowed app says that on its settings page, so the
drawing went with the menu.

What replaces it is `apps/st0/frontend/public/icon-512.png` — **the web app's icon, referenced
rather than copied**. They are the same studio, and a second PNG would be the one that stops
being updated. electron-builder derives the `.icns` and `.ico` from that single source, and
`window.ts` uses the same file for the window itself where that matters (Linux, and an
unpackaged run; macOS takes it from the bundle).

Two things to know:

- **Only the 512 size is installed on Linux.** A single PNG gives electron-builder one size,
  where an icon *directory* would give it several — st0's other sizes are named `icon-192.png`
  rather than `192x192.png`, so they cannot be used as one without copies. Desktops downscale.
- **A wrong path fails QUIETLY**: electron-builder logs `default Electron icon is used` and
  carries on. That line is the check, not the exit code.

## Packaging a `.deb` needs two fields

`author` and `homepage` in `package.json`, or the build stops before it reaches the icon. Both
are set. Note that `fpm` — the tool electron-builder shells out to for `deb` — needs a working
Ruby, and fails with exit 127 where it has none; the `dir` and `AppImage` targets do not use it.
