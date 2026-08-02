# Supervisor policy — origins, logs, processes, audio, dev reload

Background for the one-line headers in `engine-host/src`. Each section names its file.

## `webOrigins.ts` — the web UIs this engine trusts

A lanes web UI reached over a real hostname (`https://daw.test` behind Caddy, a
hosted deployment) is neither loopback nor a private address, so the file service's
deny-by-default CORS policy cannot admit it on its own (see
`packages/file-service/src/cors.ts`). This list is how the user says "that one is mine":
written here, read there, and read on EVERY request, so adding a web UI from the menu
bar takes effect immediately with nothing restarted.

`~/.lanes/web-origins.json` — `{"origins": ["https://daw.test"]}` — is part of the
shared `~/.lanes` contract, like `engine-id.json` and `web-endpoint.json`.

Only ORIGINS are stored (`scheme://host[:port]`). A browser's `Origin` header is always
bare, so a path or query the user pasted would simply never match; it's stripped at the
door rather than stored as something that silently can't work.

This module lives in engine-host rather than file-service because the SUPERVISOR is the
writer, and the writer defines the format. file-service imports it to read. That
direction stays acyclic: the host spawns the file service by PATH, not by import.

## `logbus.ts` — the merged log

The supervisor spawns both the engine and the file service; rather than two separate
files the user has to cross-reference, their stdout/stderr are piped here and written to
ONE file, each line tagged with its source and a timestamp. That single file is what the
tray's "Show logs" opens and what the file service serves to the web UI's Logs panel.

The line format is `HH:MM:SS [tag] text` and must stay BYTE-IDENTICAL to what the tray
used to write: the Logs panel seeds on a tail and then polls by byte offset, so a format
change is not cosmetic.

**TRUNCATION IS NOT OURS.** We open in APPEND mode, always. The tray truncates the file
once when it starts, because the tray's lifetime is what "a session" means — and this
process can be relaunched mid-session after a crash, at which point truncating would
wipe the log the user is reading to find out why it crashed. The tray also appends its
own `[host]` lines to the same file; single writes in append mode are atomic on both
platforms, so the two writers interleave whole lines rather than tearing.

## `fileServiceProcess.ts` — the spawn rule

The file service serves workspaces and every file operation to the browser (the C++
engine stays file-free). It runs next to the engine and dials it locally, sharing the
engine's identity so its light gate matches.

The spawn rule, which must not be simplified:

1. **Something is already answering the file port → do nothing.** In a dev run that
   something is `npm run dev` (tsx watch on 8770), which owns the service and reloads it
   on edit. Spawning a second one would fight it for the port.
2. **A bundled runtime resolves (a packaged app) → the vendored node runs the bundled
   `.mjs`.**
3. **Neither → FAILED.** That is what the red icon and the "Restart file service" menu
   entry exist for; reporting green here would be a lie the user cannot act on.

The old standalone host always spawned via `tsx`, which is branch 2 with no branch 1 —
correct standalone, wrong under a tray, where it would race `npm run dev` for 8770.

## `engineQueries.ts` — request/reply over one connection

This replaces a design where the tray opened a FRESH WebSocket per call, with loops
running at 2s / 2s / 3s — roughly one TCP handshake per second, forever, each connection
then reading and discarding the engine's ~20 Hz `state` broadcasts until its own typed
reply arrived. One connection whose firehose is simply not listened to costs nothing.

Three things the fresh-connection design got for free, rebuilt here:

1. **REQUEST/REPLY.** Every `EngineControl` method is fire-and-forget; the reply comes
   back as an event. Each function pairs a send with a one-shot listener and a deadline,
   keeping the per-call timeouts the tray used.
2. **ONE AT A TIME.** `set-audio-device` is answered with an `audio-devices` frame — the
   same type the devices poll waits for. On a shared connection a concurrent poll would
   capture the other request's reply and both would be wrong. Every call goes through
   `queue`, so exactly one is ever in flight.
3. **NO STALE STATE.** A fresh socket each time meant none; here a dropped connection has
   to be noticed and redialled (see `connected`).

## `audioPolicy.ts` — which interface the engine should be on

The engine picks *some* device at boot and, when one is pulled out from under it, falls
to whatever the OS offers next. That's not a decision the user made. The policy that
corrects it:

1. the interface the user PICKED, whenever it's present — so replugging it is enough to
   get it back, with no trip to the menu;
2. otherwise the FALLBACK they configured (typically the built-in output);
3. otherwise leave the engine alone — better a device we didn't choose than none.

Kept apart from the loop that calls it so the rules are readable and testable without a
running engine. This is supervisor POLICY (which device this machine should be on), not
a protocol capability — which is why it lives here and not in `@lanes/engine-client`.

## `devReload.ts` — restart on source change, in dev only

The mechanism is deliberately not a mechanism: we EXIT, and the tray's existing relaunch
loop (`host.rs run_forever`) starts a fresh one. That path is already built, already
tested, and already correct about the hard part — the engine survives, because it is
tracked by `~/.lanes/engine.pid` and the new supervisor adopts it. So a reload costs a
few hundred milliseconds and never touches the audio device.

Two things it must NOT do:

- **Run the shutdown path.** That deregisters and stops the engine — turning a source
  edit into an audio dropout and a registry round-trip. We exit and leave the stack
  standing; adoption picks it back up.
- **Arm in a packaged build.** The watcher is gated on running from TypeScript source
  (`isDevSource`), so a shipped app carries these few lines and never calls them.
