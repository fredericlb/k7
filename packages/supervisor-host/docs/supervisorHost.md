# The supervisor host

`engine/k7-supervisor` as the child of an Electron app: `apps/k7-standalone`
(`apps/k7-standalone/docs/standalone.md`). The Android app drives the same supervisor the same way,
from Kotlin (`engine/k7-runtime/docs/android.md`). Everything else an Electron app needs — its servers, its window,
its quit, its build — is `@frediverse/electron-shell`'s (`commons/packages/electron-shell/docs/shell.md`),
which is shared with phare and knows nothing about an engine.

| subpath | what it holds |
|---|---|
| `supervisorHost` | the supervisor spawned and kept running |
| `hostProtocol` | the NDJSON frames it speaks |
| `stageEngine` | the newest engine and supervisor builds copied into an app's staging `bin/` |

## Not a server

`engine/k7-supervisor` is native and speaks NDJSON on stdio
(`engine/k7-supervisor/docs/hostProtocol.md`), so it gets no guard and no tsx: `SupervisorHost`
spawns it directly and keeps it running. Five choices:

- **Death is read from the process, never the pipe.** The engine outlives a supervisor crash by
  design, and a stdout copy inside it would hold the pipe open; Node's `exit` event is the
  process's own.
- **A crash is relaunched on 1s→30s backoff**, reset only after a run of 20s. One that dies at
  once is broken, and relaunching it every second would bury the log.
- **The backstop kills only an engine the pidfile proves.** An engine still alive after the
  teardown is killed from `engine.pid`, and a pid is reused by the OS: `enginePid.ts` reads the
  start time and executable the supervisor wrote there and kills only when the OS reports the same
  for an executable named `k7-runtime`. A bare pid, or a process the OS will not describe, is left
  running (`engine/k7-supervisor/docs/supervisorPolicy.md`).
- **A write to a dead supervisor is logged, not thrown.** Its stdin's EPIPE has a listener, since
  an `error` event nobody hears ends the app.
- **It is spawned `detached` on Windows, and told `STUDIO_HOST_PID`.** libuv's job lets
  grandchildren break away, so the engine would survive a force-killed app. The supervisor makes
  the job itself and hands the host the only handle.

`hostProtocol` mirrors `HostProtocol.h` by hand, and partially: a field is added when a host first
reads it, and a frame's missing lists are filled by `snapshotOf`.

