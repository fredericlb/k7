# processTree.ts — why killing a child isn't enough

A plain `child.kill()` reaches only the process we hold, which is not enough for the engine:
it spawns short-lived children during a plugin scan, and one left behind holds the audio
device and the port, so the next launch fails its guard. `stopEngineDaemon` is the caller.

Both platforms need their own mechanism, and neither is optional.

- **Windows** has no signals and no process groups, so `taskkill /T` walks the parent links
  itself and `/F` forces it.
- **Unix** gets the same reach from the process GROUP, which is why every child in this repo is
  spawned `detached: true`: that makes it a group leader, so negating its pid signals the whole
  group. It falls back to the bare pid when the group is already gone.
