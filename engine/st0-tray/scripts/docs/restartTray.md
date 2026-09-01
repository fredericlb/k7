# restart-tray.mjs — the tray's edit→run loop

`npm run tray:restart` is the Rust half of what `devReload.ts` already does for the
supervisor: stop, rebuild, relaunch, and **say whether it came up**. It exists so an
agent — or anyone without the tray in front of them — can change `src-tauri/src/` and get
a running tray back from one command, with an exit code that means something.

```bash
npm run tray:restart                 # stop → build --dev → start → wait for "supervisor up"
npm run tray:restart -- --no-build   # just bounce it
npm run tray:stop                    # stop, and stay stopped
```

It is glue and nothing else: the build is `build-engine.mjs --dev`, the launch is
`start-engine.mjs`. What this script adds to those two is the stop, the ordering and the
verdict.

Those four steps — `running`, `stopAll`, `buildDevApp`, `launch` — live in
`trayProcess.mjs`, because the repo's `npm run dev` session drives the same loop from a
watcher (see [docs/dev.md](../../../../docs/dev.md)). They **throw** rather than
`process.exit`: the one-shot command turns a throw back into an exit code, and a watcher
that must outlive a failed build can afford neither an exit nor a swallowed error.

## Why not `tauri dev`

`tauri dev` is the right tool when a human is watching a terminal: it holds the console,
prints the Rust logs there, and rebuilds on save. It is the wrong tool for a scripted
loop — it never returns, so nothing downstream can say "the tray is up now", and its
output dies with the terminal. This script does the opposite: it returns, non-zero if the
tray did not come up, and leaves the app running detached.

## Why not a plain `cargo build` either

Because `target/debug/st0-tray.exe` is not the dev artifact — `out/dev/st0-tray.exe`
is, and the difference is not cosmetic. `--dev` builds with `externalBin` and `resources`
emptied and then **copies the exe out of `target/debug`**, and that copy is what makes
`hostcmd.rs` take its dev tier: `bundled()` looks for a `node` sibling of the exe, finds
none in `out/dev`, and falls through to the repo's tsx on the TypeScript source. Build
with the real config and Tauri stages the sidecars beside the exe, so `bundled()` wins —
with whatever `src-tauri/binaries/node.exe` happens to hold. When that is a zero-byte
placeholder (it is, in a tree where `engine:sidecar` never ran), the tray comes up and
loops on `could not start supervisor: os error 193`. Same reason the dev app needs no
engine rebuild: it uses `engine/st0-engine/build/` directly.

## The order is not negotiable

**Stop before build.** Windows holds a running image open for write, so cargo's relink
fails against a live tray with a confusing linker error rather than a busy-file one.

**Stop every tray, not only the one we are about to build.**
`tauri-plugin-single-instance` is keyed on the app identifier, not the path: with a tray
already up — the one `npm run engine:start` left, or an installed bundle — launching a
second makes the *new* process the no-op, and it exits without a word. So the scan matches
the image name `st0-tray.exe` and stops all of them, printing each path as it goes:
taking the menu bar from another build is worth saying out loud.

**The kill is hard, and that is fine.** The tray is windowless: there is no close message
to send it, and on Windows `process.kill` is `TerminateProcess`, so `cleanup()` in
`main.rs` never runs. Nothing leaks — the job object created in `main.rs` before anything
spawns terminates the supervisor, the engine and the file service when the tray's last
handle to it closes. What is skipped is the *graceful* path: the supervisor does not get
to deregister, so the registry keeps a stale entry until the fresh instance re-registers
seconds later. On Unix the same `process.kill` sends SIGTERM, which the signal task in
`main.rs` does turn into the clean shutdown.

**Stop every ENGINE too, not only the trays.** There are two ways an engine outlives the tray
that is supposed to take it down:

1. **The job object teardown is asynchronous.** Killing the tray returns as soon as the tray is
   gone; the OS unwinds the rest of the job afterwards. Waiting only for the tray lets a build
   start while the engine is still up.
2. **An ADOPTED engine is in no job at all.** Job membership is inherited at creation, so an engine
   started by an earlier tray and adopted by this one (`engineProcess.ts`: *"It is NOT ours — Stop
   must leave it alone"*) belongs to the DEAD tray's job, and nothing takes it down. `devReload.ts`
   makes that routine in dev: every edit under `packages/engine-host/src` restarts the supervisor
   and has the engine adopted.

Either way the survivor keeps `st0-engine.exe` open for execute and the next relink cannot
replace the image — silently, which is what makes it expensive. Every engine is stopped, whoever
started it, for the same reason every tray is: a survivor wins, and here it wins by making your
build a no-op.

## How it knows the tray is alive

A tray that starts and supervises nothing looks exactly like a healthy one from the
outside — the failure `hostcmd.rs` is written to shout about. So the script does not
report success on "the process is still running". It watches `~/.st0/.studio.log`, the
merged log `logbus::init` **truncates on every launch**, and waits for one of the lines
`host.rs` writes there: `supervisor up (pid …)`, `supervisor not found`, or `could not
start supervisor`. Only the first is success; the tail is printed either way.

The truncation is also how the script avoids reading the previous session's log: it
records the time just before launching and ignores the file until its mtime moves past it.

Before that file exists there is still a window — a Rust panic in `main` — which is why
`start-engine.mjs` redirects the tray's own stdout to `.cache/dev/tray.log` rather than
dropping it. That path is deliberately not under `~/.st0`: the layout there is a
contract owned by `packages/engine-client/src/paths.ts`, and a dev script has no business
adding to it.
