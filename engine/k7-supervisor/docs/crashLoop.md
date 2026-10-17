# An engine that keeps crashing

A third-party plugin runs inside the engine's process. One that crashes in `prepareToPlay` or on the
audio thread takes the engine down after its load returned, so LoadGuard's quarantine never pins it
(`engine/k7-runtime/docs/crashes.md`). The supervisor relaunches the engine, the client sends the
same project back, and the same plugin crashes it again. `src/CrashLoop.h` is what stops that
from going on for ever.

## A quick crash is one within a minute of its start

A death less than `kQuick` (60 s) after the engine came up is a **quick** crash, and quick crashes
count in a row. A death after a longer run starts the count again at one: a crash an hour apart
from the last is news, not a loop. The count resets only at a death, never on a timer, so the
supervisor never has to watch the clock while the engine is up.

The first quick crash is relaunched at once, like any crash: one is not a pattern. From the second,
the relaunch waits 2, 4, 8, 16, then 30 s at most, the same ceiling `supervisor-host` gives a
supervisor that keeps dying. A start that FAILS — no binary, a port held by something else — backs
off 1, 2, 4… s too but is no crash: nothing it could load caused it, so it never leads to safe mode.

## The third quick crash starts the engine in safe mode

From the `kSafeModeAfter`-th (3) quick crash, the engine is spawned with `STUDIO_ENGINE_SAFE_MODE`
set to the count. It then loads **no external plugin**: the project plays with those modules
missing, each refused with a warning that says why. Built-in modules, amp models and SFZ instruments
still load; a crash inside one of their loads is LoadGuard's to quarantine at its second strike,
which happens before the third crash brings safe mode.

Three, not two: a plugin that dies inside its load is quarantined at the second crash, so the third
start already succeeds without safe mode. What is left to reach the third is a crash after the load,
which no file can be blamed for with certainty.

## Safe mode is SAID, with the plugin it suspects

The engine names a suspect in `whoami`'s `safeMode`: the file the last engine died loading when a
LoadGuard marker says so, else the last external plugin it started loading
(`<state>/last-plugin/<pid>.txt`), which is the likeliest culprit and no more. Only file names
travel, never the folders they sit in. A browser shows it once as an error toast that stays until
dismissed; the supervisor puts it in its snapshot (`safeMode`, for the app's window) and says
`safeMode: true` in its heartbeat, so a studio's engine picker can badge the machine.

## Leaving safe mode is the user's act, or a new supervisor's

Safe mode is never left on its own: an engine that ran an hour in safe mode proves nothing about
the plugin it left out, and leaving by itself would restart the loop it ended. So it ends when:

- the user starts or restarts the engine (`engine.start`, `engine.restart`) or stops it — the next
  start is a normal one, with the count at zero;
- the supervisor itself starts again — the count lives in its memory only, and a supervisor that
  adopts an engine still in safe mode replaces it with a normal one.

The warning says the first way, since it is the one a person reaches for.

## The phones

On Android and iOS the engine is a thread of the app, so it dies WITH the supervisor and there is
no relaunch to count. The start frame carries `safeMode` all the same, for one wire everywhere;
the phones host no external plugin, so there it changes nothing.
