# The supervisor ⇄ app contract

`src/HostProtocol.h` is the written definition of what moves between the supervisor and the app
that drives it, and `packages/supervisor-host/src/hostProtocol.ts` mirrors it by hand — the arrangement
`@studio/engine-protocol` has with the C++ engine. Two spellings of one shape, so a field added on
one side is a field the other side must be told about: `HostProtocol_test.cpp` pins what the app
reads.

It is NDJSON on stdio — one JSON object per line, supervisor→app on stdout, app→supervisor on
stdin — and the rule that heads this page follows from that: *stdout IS the protocol, one stray
line corrupts the frame stream*. Nothing but `protocol::emit` writes to stdout; diagnostics go to
stderr, which the app files in its own log. Run from a config file, the supervisor has no app:
it writes no frame and reads no command ([supervisor.md](supervisor.md)).

## Two rules, both load-bearing

1. **SNAPSHOTS, NOT DELTAS.** `state` carries the whole picture every time, so the app is never
   half-right — only late — and an idle supervisor costs nothing.
2. **THE APP COMPUTES NO POLICY.** Signatures, labels-worth-of-state, and the decision to switch
   an audio device are all made in the supervisor; the app only compares a signature against
   what it last drew.

## Why a snapshot is emitted only when it changed

The app reads the snapshot field by field, and the supervisor emits one only when its
**serialisation** differs from the last. A field that flapped at loop cadence would otherwise put
the whole snapshot on the wire several times a second to redraw nothing.

That is why `sessionsSig`, `audioMenuSig`, `editPluginsSig` and `pluginsSig` exist beside the data
they summarise: they change exactly when the corresponding surface's content would. The playhead,
which moves 20 times a second, is in the sessions data and out of the signature.

`plugins` is the heaviest thing on this wire — a few hundred rows on a working machine, where every
other array is a handful. It rides the snapshot anyway, because the alternative is a
request/response channel for one list that changes only on a rescan, and `pluginsSig` already keeps
it off the wire between scans.

`downloads` is the one key that is ABSENT rather than empty: it exists only while an instrument is
queued or being fetched (`docs/instruments.md`), and a snapshot without it is the common case on
every frame. It moves once per whole percent, which is as often as the menu line it feeds can show
a change. `instruments`, the Downloads tab's rows, is always there: a handful of rows that move
only when a choice, an install or a removal does — `installed` is read from disk then, never per
frame. `instruments.download <name>` and `instruments.remove <name>` are the two commands that act
on it; the second is refused, with a reason, for the instrument being fetched right now.

`pairRequests` and `pairedDevices` are the engine's LAN pairing lists, relayed verbatim
(`engine/k7-runtime/docs/pairing.md`). They are POLLED every second rather than taken from the
engine's own pushes: the musician must see a request within the two minutes it lives, and the
engine drops an expired one without saying so, so only asking again shows it gone. The two lists are
a handful of rows that move only when a device asks, is answered or reconnects, so the second-long
poll costs a loopback round trip and no frame. `pair.approve <requestId>`, `pair.deny <requestId>`
and `pair.revoke <deviceId>` are the commands that act on them; each is followed by a poll at once,
so the row leaves the window with the click. The supervisor sees only names, addresses and codes —
the key an approved device receives goes from the engine to that device and nowhere else.

`safeMode` is ABSENT unless the engine runs without external plugins after quick crashes; it carries
the count and the plugin the engine names as the suspect, empty until the engine answered
(`docs/crashLoop.md`).

`owns` is always both-true: every subsystem it names is the supervisor's. It stays on the wire
because the app still reads it, and removing a field the other side reads is a two-sided change.

## A command carries one string

`arg` is one string, so a command whose value has parts joins them with U+001F, which no device
name, session id or plugin id can contain: `audio.priority` sends the whole ranking in one command
(a reorder is one act, and two halves of it could interleave with a device poll), `plugin.showUI`
sends `<session>\x1f<id>`. An empty `audio.priority` is meaningful — rank nothing.

## One frame only Android sends

`{"t":"engine","action":"start","id","token","port","host","origins","safeMode"}` and `{"t":"engine","action":"stop"}`.
On Android the engine is a library in the app that spawned the supervisor, so `EngineProcess.cpp`
cannot start or kill it and asks the app instead (`engine/k7-runtime/docs/android.md`). The desktop
build never emits it, which is why the desktop app has no reader for it.

## Why stdio and not a localhost socket

The app is the process the user kills, and a socket-attached supervisor that outlives a
force-killed app is a ghost engine in the picker with no UI left to stop it. Over stdio, Windows
covers it with the job object and Unix gets it for free — when the app dies the OS closes the
pipe, stdin ends, and the supervisor tears down. A loopback port would also be one any page can
`fetch()`.

## The Windows job is the supervisor's, and the host holds it

A pipe ends only the supervisor. What has to die with a force-killed host is the engine too, and
on Windows only a kill-on-close job reaches a grandchild. A host that sets `$STUDIO_HOST_PID` to
its own pid gets one without writing any Win32: before spawning anything, the supervisor creates
the job, duplicates its handle INTO the host, joins it, and closes its own copy
(`process::joinHostJob`). Two constraints decide that shape:

- **The host must be the only holder.** A job the supervisor kept open would end the engine with a
  supervisor crash, and the engine is meant to survive one and be re-adopted. Held by the host
  alone, the job lives exactly as long as the host.
- **Node's own job does not cover it.** libuv puts every child it spawns in a kill-on-close job
  that allows SILENT breakaway, so the supervisor dies with the host but the engine it starts
  escapes. A Node host therefore spawns the supervisor `detached` on Windows (no libuv job),
  and the supervisor's job replaces it.

A failure only logs `[host] no kill-on-close job` and goes on: the closing pipe still ends the
supervisor, and its teardown still stops the engine.

## One supervisor per machine

`HostLock.cpp` holds `<state>/engine-host.pid`. Without it a second supervisor would **adopt** the
first one's engine (`ownsEngine: false`) — and shutdown deliberately does not spare an adopted
engine, so quitting the second would stop the first's engine, whose crash watch restarts it two
seconds later: an unexplained audio dropout with a self-healing icon. Why the lock is refreshed
rather than trusted is in [supervisorPolicy.md](supervisorPolicy.md).
