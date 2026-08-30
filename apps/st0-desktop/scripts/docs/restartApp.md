# restart-app.mjs — the app's edit→run loop

`npm run app:restart` is the app's half of what `devReload.ts` already does for the
supervisor: stop, rebuild, relaunch, and **say whether it came up**. It exists so an
agent — or anyone without the tray in front of them — can change `src/` and get
a running tray back from one command, with an exit code that means something.

```bash
npm run app:restart                 # stop → build --dev → start → wait for "supervisor up"
npm run app:restart -- --no-build   # just bounce it
npm run app:stop                    # stop, and stay stopped
```

It is glue and nothing else: the build is `build-main.mjs`, the launch is
`start-engine.mjs`. What this script adds to those two is the stop, the ordering and the
verdict.

Those four steps — `running`, `stopAll`, `buildDevApp`, `launch` — live in
`appProcess.mjs`, because the repo's `npm run dev` session drives the same loop from a
watcher (see [docs/dev.md](../../../../docs/dev.md)). They **throw** rather than
`process.exit`: the one-shot command turns a throw back into an exit code, and a watcher
that must outlive a failed build can afford neither an exit nor a swallowed error.

## Why not just leave it running

A watch that rebuilds in place is the right tool when a human is watching a terminal: it
holds the console and prints there. It is the wrong tool for a scripted
loop — it never returns, so nothing downstream can say "the tray is up now", and its
output dies with the terminal. This script does the opposite: it returns, non-zero if the
tray did not come up, and leaves the app running detached.

## Why the dev tier is reached by itself

There used to be a whole build mode for this — an app deliberately carrying NOTHING, so the
Rust would fall through to the repo's tsx instead of a vendored `node` that might be a
zero-byte placeholder. Getting it wrong left the tray looping on
`could not start supervisor: os error 193`.

None of that survives. Unpackaged, `app.isPackaged` is false and `process.resourcesPath`
points inside `node_modules/electron`, so `hostCmd.bundled()` misses and takes the dev tier
on its own. Nothing to configure and nothing to get wrong. The dev app still needs no engine
rebuild: it uses `engine/moteur/build/` directly.

## The order is not negotiable

**Stop before build — for the ENGINE only now.** `dist/main.cjs` is an esbuild bundle, not a
linked image, so a running app does not hold it open and its build needs no stop at all. Do
not re-add one: it would reintroduce the bounce for nothing. What follows still applies to
`st0-engine`, and applied to the Rust tray this replaced — Windows holds a running image
open for write, so a relink
fails against a live tray with a confusing linker error rather than a busy-file one.

**Stop every tray, not only the one we are about to build.**
`requestSingleInstanceLock()` is keyed on the app identifier, not the path: with a tray
already up — the one `npm run engine:start` left, or an installed bundle — launching a
second makes the *new* process the no-op, and it exits without a word. So the scan matches
both the image name `studio-capot.exe` (an installed build) and the dev pidfile at
`.cache/dev/app.pid` — unpackaged, the process is `electron`, and scanning by name would find
nothing while killing every `electron` on the machine is not an option. It stops all of them,
printing each path as it goes:
taking the menu bar from another build is worth saying out loud.

**The kill is hard, and that is fine.** The script kills by pid rather than asking the window
to close, because it has to stop every instance including one that is hung; and on Windows
`process.kill` is `TerminateProcess`, so the `before-quit` handler in `main.ts` never runs.
Nothing leaks — the job object created at the top of `whenReady()` before anything spawns
terminates the supervisor, the engine and the file service when the app's last handle to it
closes. What is skipped is the *graceful* path: the supervisor does not get
to deregister, so the registry keeps a stale entry until the fresh instance re-registers
seconds later. On Unix the same `process.kill` sends SIGTERM, which `main.ts`'s signal
handlers do turn into the clean shutdown.

**Stop every ENGINE too, not only the apps.** There are two ways an engine outlives the app
that is supposed to take it down:

1. **The job object teardown is asynchronous.** Killing the app returns as soon as the app is
   gone; the OS unwinds the rest of the job afterwards. Waiting only for the app lets a build
   start while the engine is still up.
2. **An ADOPTED engine is in no job at all.** Job membership is inherited at creation, so an engine
   started by an earlier app and adopted by this one (`engineProcess.ts`: *"It is NOT ours — Stop
   must leave it alone"*) belongs to the DEAD app's job, and nothing takes it down. `devReload.ts`
   makes that routine in dev: every edit under `packages/engine-host/src` restarts the supervisor
   and has the engine adopted.

Either way the survivor keeps `st0-engine.exe` open for execute and the next relink cannot
replace the image — silently, which is what makes it expensive. Every engine is stopped, whoever
started it, for the same reason every app instance is: a survivor wins, and here it wins by making your
build a no-op.

## How it knows the app is alive

An app that starts and supervises nothing looks exactly like a healthy one from the
outside. So the script does not report success on "the process is still running". It watches
`<state>/.studio.log`, the merged log `logbus.ts` **truncates on every launch**, and waits
for one of the lines `supervisorLink.ts` writes there: `starting supervisor (in process)`
followed by the engine coming up, or `supervisor did not start`. Only the first is success;
the tail is printed either way.

The truncation is also how the script avoids reading the previous session's log: it
records the time just before launching and ignores the file until its mtime moves past it.

Before that file exists there is still a window — a crash before `whenReady` — which is why
`start-engine.mjs` redirects the tray's own stdout to `.cache/dev/tray.log` rather than
dropping it. That path is deliberately not under `<state>`: the layout there is a
contract owned by `packages/engine-client/src/paths.ts`, and a dev script has no business
adding to it.
