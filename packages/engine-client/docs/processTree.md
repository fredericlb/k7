# processTree.ts — why killing a child isn't enough

A plain `child.kill()` reaches only the process we hold, which is not enough for either
of the long-lived processes pistes starts:

- **The file service** forks helpers, and under `tsx` the process we hold is a launcher
  whose GRANDCHILD is the actual server. Kill the parent alone and the grandchild keeps
  listening on 8770, so the next start finds the port taken and the tray reports a
  service it does not own.
- **The engine** spawns short-lived children during a plugin scan, and one left behind
  holds the audio device and the port, so the next launch fails its guard.

Both callers (`stopEngineDaemon`, and the supervisor's file-service teardown) used to
carry their own copy of this, comments included. One copy now, in the lowest package
that needs it.

Both platforms need their own mechanism, and neither is optional.
