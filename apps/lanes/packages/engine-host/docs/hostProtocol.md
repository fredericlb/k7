# hostProtocol.ts — the supervisor ⇄ tray contract

The tray spawns the host and talks to it over NDJSON on stdio — one JSON object per
line, host→tray on stdout, tray→host on stdin. `hostProtocol.ts` is the single written
definition of that format, mirrored BY HAND in Rust
(`engine-tray/src-tauri/src/host.rs`), the same way `@lanes/engine-protocol` is
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

## Why stdio and not a localhost socket

The tray is the process the user kills, and a socket-attached host that outlives a
force-killed tray is a ghost engine in the picker with no UI left to stop it.

Over stdio, Windows covers it with the job object and Unix gets it for free — when the
tray dies the OS closes the pipe, stdin ends, and the host tears down.

A loopback port would also sit in front of `weburi.add`, which widens the CORS
allowlist, and any page can `fetch()` a loopback port.
