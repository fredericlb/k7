# hostProtocol.ts — the supervisor ⇄ tray contract

The tray spawns the host and talks to it over NDJSON on stdio — one JSON object per
line, host→tray on stdout, tray→host on stdin. `hostProtocol.ts` is the single written
definition of that format, mirrored BY HAND in Rust
(`engine/capot/src-tauri/src/host.rs`), the same way `@studio/engine-protocol` is
mirrored in the C++ engine.

## Three rules, all load-bearing

1. **STDOUT IS THE PROTOCOL.** Nothing else may write to it — see `ipcStdio.ts`, which
   redirects console output to stderr at module load and pipes every child rather than
   letting it inherit. One stray line corrupts the frame stream.
2. **SNAPSHOTS, NOT DELTAS.** `state` carries the whole picture every time, so a host
   that crashed and relaunched resyncs the tray in one message with no replay.
3. **THE TRAY COMPUTES NO POLICY.** Signatures, labels-worth-of-state, and the decision
   to switch an audio device are all made in the supervisor; the tray only compares a
   signature against what it last drew.

## `HostOwnership` — one owner per subsystem, on the wire

A subsystem is owned either by the Rust tray or by the supervisor, never by both, and
`HostOwnership` is that made explicit: the tray merges only the parts of a snapshot whose flag
is set. Two writers racing over one piece of state is the failure it makes unrepresentable.

When all three are permanently true this collapses to "the tray replaces its state wholesale" and
the type can go.

Identity, settings, the registry and the web-origins allowlist are deliberately **not** in it:
they have no half-owned state, so their snapshot fields are always authoritative.

## Why a snapshot is emitted only when it changed

`HostSnapshot` is read field by field by the tray's `refresh()` and its three submenu builders,
and the host emits one only when its **serialisation** differs from the last. The arrays are
re-serialised on every emit, so a field that flapped at loop cadence would put the whole snapshot
on the wire several times a second to redraw nothing.

That is why `sessionsSig`, `audioMenuSig` and `editPluginsSig` exist beside the data they
summarise: they change exactly when the corresponding submenu's content would, and the tray
compares them against what it last drew. The playhead, which moves 20 times a second, is in the
sessions data and out of the signature.

## Why stdio and not a localhost socket

The tray is the process the user kills, and a socket-attached host that outlives a
force-killed tray is a ghost engine in the picker with no UI left to stop it.

Over stdio, Windows covers it with the job object and Unix gets it for free — when the
tray dies the OS closes the pipe, stdin ends, and the host tears down.

A loopback port would also sit in front of `weburi.add`, which widens the CORS
allowlist, and any page can `fetch()` a loopback port.
