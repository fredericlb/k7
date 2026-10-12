# The supervisor host

`engine/st0-supervisor` as the child of an Electron app. Two apps use it: `apps/st0-standalone`
(`apps/st0-standalone/docs/standalone.md`) and the menu-bar tray, `engine/st0-tray`
(`engine/st0-tray/docs/tray.md`). Everything else an Electron app needs — its servers, its window,
its quit, its build — is `@frediverse/electron-shell`'s (`commons/packages/electron-shell/docs/shell.md`),
which is shared with phare and knows nothing about an engine.

| subpath | what it holds |
|---|---|
| `supervisorHost` | the supervisor spawned and kept running |
| `hostProtocol` | the NDJSON frames it speaks |
| `stageEngine` | the newest engine and supervisor builds copied into an app's staging `bin/` |

## Not a server

`engine/st0-supervisor` is native and speaks NDJSON on stdio
(`engine/st0-supervisor/docs/hostProtocol.md`), so it gets no guard and no tsx: `SupervisorHost`
spawns it directly and keeps it running. Three choices:

- **Death is read from the process, never the pipe.** The engine outlives a supervisor crash by
  design, and a stdout copy inside it would hold the pipe open; Node's `exit` event is the
  process's own.
- **A crash is relaunched on 1s→30s backoff**, reset only after a run of 20s. One that dies at
  once is broken, and relaunching it every second would bury the log.
- **It is spawned `detached` on Windows, and told `STUDIO_HOST_PID`.** libuv's job lets
  grandchildren break away, so the engine would survive a force-killed app. The supervisor makes
  the job itself and hands the host the only handle.

`hostProtocol` mirrors `HostProtocol.h` by hand, and partially: a field is added when a host first
reads it, and a frame's missing lists are filled by `snapshotOf`.

