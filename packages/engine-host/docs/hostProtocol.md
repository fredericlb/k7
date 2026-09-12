# hostProtocol.ts — the supervisor ⇄ app contract

`hostProtocol.ts` is the single written definition of what moves between the supervisor and
whatever is driving it, and every driver **imports it**: there is no mirror. There was one, by
hand in Rust, until the app was ported to Electron — losing it is the largest thing that port
bought. `@studio/engine-protocol` still is mirrored by hand in the C++ engine, and still has
to be.

It is NDJSON on stdio — one JSON object per line, host→tray on stdout, tray→host on stdin —
and the rule that heads this page follows from that: *stdout IS the protocol,
one stray line corrupts the frame stream*. The types did not change with it, and that is the
point: what a frame MEANS never depended on how it travelled.

## Two rules, both load-bearing

1. **SNAPSHOTS, NOT DELTAS.** `state` carries the whole picture every time, so a driver is
   never half-right — only late — and an idle supervisor costs nothing.
2. **THE DRIVER COMPUTES NO POLICY.** Signatures, labels-worth-of-state, and the decision
   to switch an audio device are all made in the supervisor; a view only compares a
   signature against what it last drew. Sharing an address space with it changes nothing
   here: reach past the transport and `cli.ts` becomes the lesser front end.

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

That is why `sessionsSig`, `audioMenuSig`, `editPluginsSig` and `pluginsSig` exist beside the
data they summarise: they change exactly when the corresponding surface's content would, and the
tray compares them against what it last drew. The playhead, which moves 20 times a second, is in
the sessions data and out of the signature.

`plugins` is the heaviest thing on this wire — a few hundred rows on a working machine, where
every other array is a handful. It rides the snapshot anyway, because the alternative is a
request/response channel for one list that changes only on a rescan, and `pluginsSig` already
keeps it off the wire between scans. What it costs is a fatter frame on the emits some OTHER
field triggers; those are seconds apart, not frames apart.

## Why stdio and not a localhost socket

The tray is the process the user kills, and a socket-attached host that outlives a
force-killed tray is a ghost engine in the picker with no UI left to stop it.

Over stdio, Windows covers it with the job object and Unix gets it for free — when the
tray dies the OS closes the pipe, stdin ends, and the host tears down.

A loopback port would also sit in front of `weburi.add`, which widens the CORS
allowlist, and any page can `fetch()` a loopback port.

## Two front ends, one supervisor

`startSupervisor` takes its channel as a **`HostTransport`** rather than importing one, which
is what lets the same supervisor serve two callers without a second implementation of the
contract:

| entry | transport | who drives it |
|---|---|---|
| `supervisorLink.ts`, in the desktop app | direct calls, in the app's own process | the window |
| `src/cli.ts` (`studio-engine`) | a status line on a terminal, and no commands at all | a person who wants only the engine |

They differ in one more thing than the transport, and it is worth knowing: the CLI **owns its
process** and the embedded one does not. `SupervisorOptions.exit` is how that is said — pass
one and the supervisor stops calling `process.exit` and stops installing signal handlers,
because both belong to the host then.

### What stops either outliving its driver

The app's supervisor cannot: it IS the app, and shares its exit. The CLI has no such
guarantee, so the bounds are: it never daemonises or forks (the terminal IS the window),
SIGINT/SIGTERM run `shutdown()`, and **SIGHUP** is handled too — closing a terminal sends it,
and Node's default terminates without running the exit path, leaving the engine holding the
audio device and both ports with nothing on screen to explain it. Those handlers are installed
only when no `exit` was passed, so the embedded one does not race the app's own teardown.

And `hostLock.ts` guards both: one supervisor per machine, in `<state>/engine-host.pid`.
Without it a CLI started beside the app would **adopt** the app's engine (`ownsEngine: false`)
— and `shutdown` deliberately does not spare an adopted engine, so Ctrl-C on the CLI would stop
the app's engine, whose crash-watch restarts it two seconds later. The only symptom is an
unexplained audio dropout with a self-healing icon. `src/hostLock.test.ts` is the test.
