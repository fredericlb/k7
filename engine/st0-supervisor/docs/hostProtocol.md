# The supervisor ⇄ tray contract

`src/HostProtocol.h` is the written definition of what moves between the supervisor and the tray
that drives it, and `engine/st0-tray/src-tauri/src/host.rs` mirrors it by hand — the arrangement
`@studio/engine-protocol` has with the C++ engine. Two spellings of one shape, so a field added on
one side is a field the other side must be told about: `HostProtocol_test.cpp` pins what the tray
reads.

It is NDJSON on stdio — one JSON object per line, supervisor→tray on stdout, tray→supervisor on
stdin — and the rule that heads this page follows from that: *stdout IS the protocol, one stray
line corrupts the frame stream*. Nothing but `protocol::emit` writes to stdout; diagnostics go to
stderr, which the tray files in the merged log.

## Two rules, both load-bearing

1. **SNAPSHOTS, NOT DELTAS.** `state` carries the whole picture every time, so the tray is never
   half-right — only late — and an idle supervisor costs nothing.
2. **THE TRAY COMPUTES NO POLICY.** Signatures, labels-worth-of-state, and the decision to switch
   an audio device are all made in the supervisor; the tray only compares a signature against
   what it last drew.

## Why a snapshot is emitted only when it changed

The tray reads the snapshot field by field, and the supervisor emits one only when its
**serialisation** differs from the last. A field that flapped at loop cadence would otherwise put
the whole snapshot on the wire several times a second to redraw nothing.

That is why `sessionsSig`, `audioMenuSig`, `editPluginsSig` and `pluginsSig` exist beside the data
they summarise: they change exactly when the corresponding surface's content would. The playhead,
which moves 20 times a second, is in the sessions data and out of the signature.

`plugins` is the heaviest thing on this wire — a few hundred rows on a working machine, where every
other array is a handful. It rides the snapshot anyway, because the alternative is a
request/response channel for one list that changes only on a rescan, and `pluginsSig` already keeps
it off the wire between scans.

`owns` is always both-true: every subsystem it names is the supervisor's. It stays on the wire
because the tray still reads it, and removing a field the other side reads is a two-sided change.

## A command carries one string

`arg` is one string, so a command whose value has parts joins them with U+001F, which no device
name, session id or plugin id can contain: `audio.priority` sends the whole ranking in one command
(a reorder is one act, and two halves of it could interleave with a device poll), `plugin.showUI`
sends `<session>\x1f<id>`. An empty `audio.priority` is meaningful — rank nothing.

## One frame only Android sends

`{"t":"engine","action":"start","id","token","port","host"}` and `{"t":"engine","action":"stop"}`.
On Android the engine is a library in the app that spawned the supervisor, so `EngineProcess.cpp`
cannot start or kill it and asks the app instead (`engine/st0-engine/docs/android.md`). The desktop
build never emits it, which is why the tray has no reader for it.

## Why stdio and not a localhost socket

The tray is the process the user kills, and a socket-attached supervisor that outlives a
force-killed tray is a ghost engine in the picker with no UI left to stop it. Over stdio, Windows
covers it with the job object and Unix gets it for free — when the tray dies the OS closes the
pipe, stdin ends, and the supervisor tears down. A loopback port would also be one any page can
`fetch()`.

## One supervisor per machine

`HostLock.cpp` holds `<state>/engine-host.pid`. Without it a second supervisor would **adopt** the
first one's engine (`ownsEngine: false`) — and shutdown deliberately does not spare an adopted
engine, so quitting the second would stop the first's engine, whose crash watch restarts it two
seconds later: an unexplained audio dropout with a self-healing icon. Why the lock is refreshed
rather than trusted is in [supervisorPolicy.md](supervisorPolicy.md).
