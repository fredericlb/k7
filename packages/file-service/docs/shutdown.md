# shutdown.ts — how the file service stops

The file service is stopped by a signal or by its stdin closing: the file hub's `stopAll` asks
each account's process both ways when k7's backend stops, and a terminal sends SIGINT.
`shutdown.ts` answers all three the same way.

## Decisions

- **The end of stdin is a stop, when the spawner says so.** Windows delivers no SIGTERM to Node: a
  `kill` there ends the process on the spot. So the file hub spawns the service with a stdin pipe
  and `ELECTRON_SHELL_STDIN_STOP=1`, the convention the desktop app's guard uses for its servers
  (`commons/packages/electron-shell/docs/shell.md`), and closing that pipe is the graceful stop
  everywhere. The variable is removed once read, so nothing the service spawns inherits it. Without
  it, stdin is left alone: a service run from a terminal must not stop when the terminal's stdin does.
  The pipe has a second use: a hub that dies, however it dies, closes it, and its services follow.

- **Stop accepting, let the requests in flight answer, exit 0.** The listener is closed, idle
  keep-alive sockets with it, and the process exits as soon as the last request has answered.
- **A grace of 5 s, then out anyway.** A request that never ends must not hold the quit: the
  backend above this process waits 8 s for its children (`apps/k7/backend/src/server.ts`), and the
  desktop app's guard longer than that (`commons/packages/electron-shell/docs/shell.md`).
- **Nothing is flushed on the way out.** Every file this service writes goes through
  `writeFileAtomic` (`packages/song/docs/atomicWrite.md`) synchronously, so a signal — handled
  between two tasks of the event loop — never lands in the middle of a write, and a SIGKILL
  leaves the old file or the new one. An edit live capture had not yet sent is not lost either: a
  restart diffs the workspace against the confirmed mirror (`liveCapture.md`).
- **Exit code 0.** A stop that was asked for is not a failure.
