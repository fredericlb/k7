# restart-tray.mjs — the tray's edit→run loop

`npm run tray:restart` does for the tray what `devReload.ts` does for the supervisor: stop,
rebuild, relaunch, and **say whether it came up**. It exists so an agent — or anyone without the
tray in front of them — can change `src/` and get a running tray back from one command, with an
exit code that means something.

```bash
npm run tray:restart                 # stop → bundle → start → wait for "supervisor up"
npm run tray:restart -- --no-build   # just bounce it
npm run tray:stop                    # stop, and stay stopped
```

It is glue and nothing else: the build is `build-main.mjs`, the launch is `start-detached.mjs`.
What this script adds to those two is the stop, the ordering and the verdict.

Those steps — `running`, `stopAll`, `buildDevApp`, `launch` — live in `trayProcess.mjs`, because
the repo's `npm run dev` session drives the same loop from a watcher (see
[docs/dev.md](../../../../docs/dev.md)). They **throw** rather than `process.exit`: the one-shot
command turns a throw back into an exit code, and a watcher that must outlive a failed build can
afford neither an exit nor a swallowed error.

## Why not `npm start`

`npm start` is the right tool when a human is watching a terminal: it holds the console and the
tray's output lands there. It is the wrong tool for a scripted loop — it never returns, so nothing
downstream can say "the tray is up now", and its output dies with the terminal. This script does
the opposite: it returns, non-zero if the tray did not come up, and leaves the tray running
detached, its output in `.cache/dev/tray.log`.

## Which processes are trays

Two kinds, found two ways:

- **An installed tray** runs as `k7-tray` (`k7-tray.exe`), and is found by image name — and on
  Windows by executable path too, since a process whose image was replaced under it shows a
  garbled name.
- **A dev tray** is Electron run on this checkout, so its image name is Electron's, shared with
  every other Electron app on the machine. It is found by its command line instead: an `electron`
  main process whose last argument is this directory. Its helpers carry `--type=` and are left to
  die with it.

## The order is not negotiable

**Stop every tray, not only the one we are about to start.** Electron's single-instance lock is
keyed on the app's name, which an installed tray and a dev one share: with either already up,
launching another makes the *new* process the no-op, and it exits without a word. So every tray is
stopped, each path printed as it goes: taking the menu bar from another build is worth saying out
loud.

**The kill is a signal, and on Windows a hard one.** On Unix `process.kill` sends SIGTERM, which
the tray turns into its clean shutdown. On Windows it is `TerminateProcess`, so the shutdown never
runs; nothing leaks — the job the supervisor made and the tray held ends the supervisor and the
engine when the tray's handle closes — but the supervisor does not get to deregister, so the
registry keeps a stale entry until the fresh instance re-registers seconds later.

**Stop every ENGINE too, not only the trays.** There are two ways an engine outlives the tray
that is supposed to take it down:

1. **The job teardown is asynchronous.** Killing the tray returns as soon as the tray is gone;
   the OS unwinds the rest of the job afterwards. Waiting only for the tray lets a build start
   while the engine is still up.
2. **An ADOPTED engine is in no job of ours.** Job membership is inherited at creation, so an
   engine started under an earlier tray and adopted by this one belongs to the DEAD tray's job,
   and nothing takes it down.

Either way the survivor keeps `k7-runtime.exe` open for execute and the next engine relink cannot
replace the image — silently, which is what makes it expensive. Every engine is stopped, whoever
started it.

### A probe that does not answer is not an answer

Each look at the process table is one `Get-CimInstance` — or `pgrep` off Windows — and it can
fail for reasons that have nothing to do with what is running: a spawn refused under the load of
the build that just finished, a shell that would not start. Reporting that as an empty list makes
both halves of this script lie in opposite directions. `stopAll` concludes there is nothing to
stop and leaves a survivor; `launch` concludes the tray it just started has died, and says so about
a tray that is up and playing.

So a query that does not answer is retried, and then **throws**. The one case that needs saying:
`pgrep` reports "nothing matched" with exit 1, which is an answer and not a failure.

## How it knows the tray is alive

A tray that starts and supervises nothing looks exactly like a healthy one from the outside — the
failure `src/paths.ts` is written to shout about. So the script does not report success on "the
process is still running". It watches `<state>/.studio.log` — where `<state>` is `$STUDIO_HOME` or
`~/.k7`, resolved through `scripts/stateDir.mjs` so an overridden state dir is followed too — the
merged log the tray **truncates on every launch**, and waits for one of the lines it writes there:
`supervisor up (pid …)`, `supervisor not found`, or `could not start supervisor`. Only the first is
success; the tail is printed either way.

The truncation is also how the script avoids reading the previous session's log: it records the
time just before launching and ignores the file until its mtime moves past it.

Before that file is open there is still a window — a throw at the top of `main.ts` — which is why
`start-detached.mjs` sends the tray's own stdout to `.cache/dev/tray.log` rather than dropping it.
That path is deliberately not under `~/.k7`: the layout there is a contract owned by
`packages/engine-client/src/paths.ts`, and a dev script has no business adding to it.
