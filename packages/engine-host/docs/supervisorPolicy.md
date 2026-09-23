# Supervisor policy — origins, logs, processes, audio

Background for the one-line headers in `engine-host/src`. Each section names its file.

## `supervisor.ts` — the loops, and the pace each one runs at

Nothing here is pushed: the engine has no callback for an interface being unplugged or a song
being loaded, so the supervisor asks. Every poll therefore costs something forever, and the
interval is the whole of the design.

| constant | why that pace |
|---|---|
| `WATCH_MS` (2 s) | both process watches. Fast enough that a crash is noticed before the user is, slow enough to be free — each tick is a pidfile stat or a socket connect. |
| `DEVICES_POLL_MS` (10 s) | this is what notices an interface being plugged in or pulled out — and it is the one poll that TOUCHES A DRIVER. See below. |
| `SESSIONS_POLL_MS` (2 s) | an app connecting or a song loading is a human-speed event, and the submenu redraws only when the signature moves anyway. |
| `EDIT_PLUGINS_POLL_MS` (3 s) | a user swaps songs at human speed, not interface-unplug speed. |
| `PLUGINS_POLL_MS` (60 s) | the plugin scan is expensive and the answer barely moves. Until it lands we ask at `PLUGINS_POLL_FAST_MS` (2 s) instead, to keep the spinner honest — that poll reschedules itself rather than sitting on one interval. |
| `BACKOFF_MAX_S` (30 s) | the relaunch backoff for a crashing engine, doubling from 1 s. One that dies on startup — a bad audio device, a missing DLL — would otherwise be relaunched forever at one per second, and the log would be nothing but that. |
| `DEREGISTER_TIMEOUT_MS` (1.5 s) | a hung registry must not hold the quit open. The tray gives the supervisor about 3 s in total before it kills it. |

### Why the device poll is the slow one

The other polls cost a `stat`, a socket connect or a state read. This one calls `scanForDevices()`
on **every** device type, ASIO included, inside the engine process, while the audio callback is
running. Measured on the reference machine: **50 ms per scan**, six times out of six.

The callback does not suffer for it — also measured: its maximum during a burst of scans is
0.278 ms against 0.356 without, so within the noise. It is not a realtime problem. It is that
**this is the only thing the engine does that genuinely reaches the driver**, and an ASIO driver is
single-client: polling it continuously while it streams is the kind of pressure that wakes an
assertion in a vendor's kernel driver.

**The setting is a slider, and 10 s is where it stopped.** At 2 s the driver takes 1800 scans an
hour; at 10 s it takes 360, at 30 s it would take 120. The step from 1800 to 360 carries almost all
of the reduction, while half a minute before a plugged-in interface is noticed is felt in use.

**What it costs anyway.** Plugging the interface in takes up to 10 s to be noticed, so does
falling to the next name in the order, and the tray's submenu is that far out of date. That is the
price, and it is paid on every plug.

**The real fix.** JUCE exposes an `AudioIODeviceType::Listener` that Windows feeds on hardware
arrival and removal. Moving to it would give both at once — immediate reaction AND zero periodic
scan — but it is work inside the engine, worth doing only if polling proves to be the culprit.

### Signatures, not arrays

The tray rebuilds a submenu whenever the snapshot it draws from changes, so what the polls
compare is a **signature** rather than the data.

- The audio menu compares `menuSignature`, so a device list that came back identical redraws
  nothing.
- The edit-plugin signature is built from the OPENABLE ids and is **session-qualified**: the same
  module id in two projects is two rows, and the signature has to change when one of them goes.
- The plugin signature is `format` + `name` over the whole catalogue, and the list is sorted
  before it is built: the engine answers in scan order, and a reordered scan is not a changed
  catalogue. A rescan that found exactly the same plugins still publishes, because `pluginCount`
  is null until it lands and that null IS the spinner.
- The session signature includes `playing` and `listeners` because those are on the label — they
  are the two facts that answer "who is using my interface right now". The **playhead is not in
  it**, and that is the point of having a signature at all: it moves 20 times a second and would
  put the whole snapshot on the wire with it.

### Bringing the file service up, including the adopted case

`ensureFileService` is called from every start path, and the ADOPT case is why. A force-killed
tray leaves its engine and its pidfile behind but **not** its file service, so a launch that
adopted the orphan and skipped this would come up with no file service at all — the "no answer on
:8770" the web UI shows.

It is handed **all** the registry URLs, comma-joined: the file service builds its CORS allowlist
from them, and every service holding a registry is a browser that will call it. Passing the first
alone would refuse the médiathèque with nothing logged anywhere.

The watch over it, unlike the engine's crash watch, **never relaunches**. A file service that
keeps falling over is something the user should see and act on rather than have papered over, and
the restart is one menu click away. It reports **both ways**, because it is a live reading rather
than a failure record: restart `npm run dev` and the icon should go green again on its own.

### Where the registries come from

`resolveRegistryUrls` reads two tiers, the first that yields anything winning outright — they are
alternatives, not a union:

1. what the user added in the tray's **st0 instances** tab — a deliberate, persisted choice beats
   an ambient one, which is why it sits above the environment variable;
2. `$STUDIO_REGISTRY_URL`, comma-separated for more than one.

**There is no third tier, and no default.** When neither yields anything the list is empty: the
engine heartbeats to nobody and appears in no picker. A machine is connected to a st0 instance
because someone connected it, never because the build assumed one or a backend happened to be
running — so a fresh install suggests nothing, and `web-origins.json` is not seeded either. An
empty list is the normal state of a fresh machine, not a fault, which is why the tray does not
paint it red.

**What the local backends advertise is deliberately not read.** Each still writes
`<state>/web-endpoints/<service>.json` on boot (`packages/engine-registry/advertise.ts`), and the
file service reads pl8's to find the médiathèque, but the supervisor used to heartbeat to every URL
in there. That made a dev machine connect itself to whatever happened to be running — and, since a
killed backend leaves its file behind, to things that had stopped running. Under `npm run dev` add
`http://localhost:8789` once in the tab; it is persisted like any other instance.

Neither tier moves while the supervisor runs, so the list is resolved at boot and on an add or a
remove, never per heartbeat.

Every URL, whichever tier it came from, is read as its family's **one registry, pl8's**
(`engineRegistryUrl` in `packages/web-protocol/services.ts`): `https://st0.app` and
`https://play.st0.app` both mean `https://play.st0.app`, and `http://localhost:8789` means
`http://localhost:8795`. st0 holds no registry — it lists engines from pl8
(`packages/engine-registry/docs/shared.md`) — so a st0 URL an older settings file pinned is
migrated in the reader rather than heartbeated at a route that no longer exists. The answer is
still a **list**, one per studio this engine is connected to, deduped.

The heartbeat is **all-or-nothing**: the tray shows one light, so "ok" has to mean every studio
can offer this engine. A registry that is down is simply absent from that studio's picker, which
is correct — it genuinely cannot be driven right now.

The médiathèque this machine caches is **derived** from those URLs rather than configured: every
service sits on one origin at a fixed path, so only the origin varies, and asking for the
library's URL separately makes a second hand-typed copy of a fact already on disk — which is how a
machine ends up heartbeating to one studio and syncing from another. Only the origin is kept and
the path comes back from the service table. The first resolvable registry wins, and an
unparseable one yields nothing rather than an empty string the file service would read as
configured.

The tray's **st0 instances** tab draws `instances`, one row per studio FAMILY (`studioFamily`:
st0's origin, or the bare host on loopback): the union of the registries and `web-origins.json`,
because to the user st0, pl8's registry and both services' pages are one instance. `weburi.remove` therefore disconnects **the whole family**: every origin of it leaves the
allowlist, the matching pinned registry leaves the settings, and that registry is deregistered at
once so the engine drops out of its picker rather than aging out. A registry from `$STUDIO_REGISTRY_URL` is
marked not removable — the environment is not the supervisor's to edit. Removing the last pinned one
falls back to the ambient tiers, exactly as a fresh boot would. The file service's CORS list is
still the one captured at its spawn, so a removed registry's origin keeps reaching it until the file
service next restarts — the same limit an add already has in the other direction.

`addRegistryUrl` is an **add**, not a replace: connecting a second studio must not disconnect
the first. It takes any URL of the family and stores pl8's, is idempotent beyond re-announcing,
and persists the result as the explicit list so the next boot takes it rather than the ambient
environment variable.

Adding an instance (`weburi.add`) also allows BOTH services' pages — st0's origin, which z0 lives
under, and pl8's — since each drives the engine's file service. On a loopback host nothing is
added: the file service admits any private `http` origin already. The file service's own
`$STUDIO_REGISTRY_URL` list admits each registry's st0 origin alongside it, for the same reason.

### Shutdown order

Deregister **first**, while the entry still means something, but bounded by
`DEREGISTER_TIMEOUT_MS`. Then tear down — and unlike Stop, this does **not** spare an adopted
engine: one left listening holds the audio device and both ports for whatever launches next.

## `webOrigins.ts` — the web UIs this engine trusts

A st0 web UI reached over a real hostname (`https://daw.test` behind the proxy, a hosted
deployment) is neither loopback nor a private address, so the file service's deny-by-default CORS
policy cannot admit it on its own (see `packages/file-service/src/cors.ts`). This list is how the
user says "that one is mine": written here, read there, and read on EVERY request, so adding a st0
instance from the tray's settings takes effect immediately with nothing restarted. It starts empty:
nothing is seeded, for the reason there is no default registry.

`<state>/web-origins.json` — `{"origins": ["https://daw.test"]}` — is part of the shared `<state>`
contract, like `engine-id.json` and `web-endpoint.json`.

Only ORIGINS are stored (`scheme://host[:port]`). A browser's `Origin` header is always bare, so a
path or query the user pasted would simply never match; it is stripped at the door rather than
stored as something that silently cannot work.

This module lives in engine-host rather than file-service because the SUPERVISOR is the writer,
and the writer defines the format. file-service imports it to read. That direction stays acyclic:
the host spawns the file service by PATH, not by import.

## `logbus.ts` — the merged log

The supervisor spawns both the engine and the file service; rather than two separate files the
user has to cross-reference, their stdout/stderr are piped here and written to ONE file, each line
tagged with its source and a timestamp. That single file is what the tray's "Show logs" opens and
what the file service serves to the web UI's Logs panel.

The line format is `HH:MM:SS [tag] text` and must stay BYTE-IDENTICAL: the Logs panel seeds on a
tail and then polls by byte offset, so a format change is not cosmetic.

**TRUNCATION IS NOT OURS.** We open in APPEND mode, always. The tray truncates the file once when
it starts, because the tray's lifetime is what "a session" means — and this process can be
relaunched mid-session after a crash, at which point truncating would wipe the log the user is
reading to find out why it crashed. The tray also appends its own `[host]` lines to the same file;
single writes in append mode are atomic on both platforms, so the two writers interleave whole
lines rather than tearing.

## `fileServiceProcess.ts` — the spawn rule

The file service serves workspaces and every file operation to the browser (the C++ engine stays
file-free). It runs next to the engine and dials it locally, sharing the engine's identity so its
light gate matches.

The spawn rule, which must not be simplified:

1. **Something is already answering the file port → do nothing.** In a dev run that something is
   `npm run dev` (tsx watch on 8770), which owns the service and reloads it on edit. Spawning a
   second one would fight it for the port.
2. **A bundled runtime resolves (a packaged app) → the vendored node runs the bundled `.mjs`.**
3. **A checkout resolves and we are running FROM source → our own interpreter runs its
   `server.ts`.**
4. **None of them → FAILED.** That is what the red icon and the "Restart file service" menu entry
   exist for; reporting green here would be a lie the user cannot act on.

Branch 1 is the one that looks droppable and is not: without it the spawn races `npm run dev` for
8770. It is also what makes branch 3 safe — the checkout tier can only ever fire on a port the
watcher has left free.

Branch 3 is why `studio-engine` is a whole program in a checkout, with nothing built. Without it
the only layout that resolves a file service is the one `engine/st0-tray/scripts/build-engine.mjs`
creates, so a CLI that depends on no Electron app would have needed the Electron app's build —
and the engine binary has had a checkout tier all along (`engine-client`'s `findEngineBinary`),
which is the asymmetry this closes.

Its condition is `process.argv[1]` ending in `.ts`: our entry being TypeScript is the proof that
this interpreter reads source, and the child inherits `process.execPath` and `process.execArgv`
so it reads it the same way — tsx's loader flags when tsx launched us, nothing at all on a Node
that strips types itself. Anything else — a bundled `.mjs`, an Electron main process whose
`execPath` is not node — fails that test and falls to FAILED rather than spawning something that
cannot run.

## `engineProcess.ts` — adopting, and what a pidfile is not

A pidfile is what makes a supervisor crash survivable: the engine outlives us, and the next
supervisor ADOPTS it rather than finding the port held by a process nobody owns.

What it is not is an identity. `engineRunning()` asks the operating system whether that NUMBER is a
live process — nothing more — and a pid is reused. Trusting it alone is silent in every direction:
the engine dies, the OS hands its pid to an unrelated `node`, and the next supervisor reads the
pidfile, finds the pid alive, logs *adopting the engine already on the pidfile* and spawns nothing.
The crash watch asks the same question, so it never relaunches either; the heartbeat asks it too,
so every registry goes on being told an engine is there, and every app lists a machine that answers
nothing.

So the port is asked as well: adopt only if something is actually serving on it, and otherwise
treat the pidfile as stale, clear it and start a fresh engine. The dead pid's process is left alone
— it belongs to somebody else now.

**Why here and not in the crash watch.** The same check there would be the complete fix, and it
carries a risk this one does not: a probe that answers wrongly under load would relaunch an engine
that is playing. `start()` runs before anything plays, so a wrong answer costs a spare engine
instead of somebody's audio. Extending it to the crash watch is a real decision — it needs
consecutive failures before acting — and it has not been taken.

## `hostLock.ts` — the same lesson, one file over

One supervisor per machine, in `<state>/engine-host.pid`. Asking only whether the pid is **alive**
is unrecoverable here: a supervisor crashes, Windows hands its pid to an unrelated process — this
app spawns plenty — and from then on every supervisor reads the pidfile, finds a live pid, and
refuses. For ever. The check that exists to clear a stale lock (`rmSync` when the pid is dead) can
never fire, because the pid is not dead; it just is not a supervisor. The app runs, supervises
nothing, and says `an engine supervisor is already running (pid …)` on a loop.

`engineProcess.ts` solves its half by asking the **port** as well. The supervisor listens on
nothing, so there is no port to ask, and the analogue is the one `engine-registry` already uses for
`assignedSeen`: **the holder keeps saying so.** `acquire()` starts a 2 s refresh of the file's
mtime, and a lock nobody has refreshed for 15 s is stale whatever its pid claims. A recycled pid
costs at most fifteen seconds.

Both tests are in `hostLock.test.ts`, and the pair is the point: a lock that is stale AND alive is
taken, a lock that is being refreshed is refused. Staleness must not become a way to steal a live
supervisor's lock — seven missed beats is the margin, and a main thread stalled that long is
pathological rather than busy.

The refresh also **reads before it writes**. A lock that has come to name somebody else was taken
from us, which is the one thing this file exists to make impossible, so it is reported rather than
silently overwritten.

## `engineQueries.ts` — request/reply over one connection

The polls run at 10 s / 2 s / 3 s, so a fresh WebSocket per call would be roughly one TCP handshake
per second, forever, each connection then reading and discarding the engine's ~20 Hz `state`
broadcasts until its own typed reply arrived. One connection whose firehose is simply not listened
to costs nothing.

Three things a fresh connection per call would give for free, and that a shared one has to provide
itself:

1. **REQUEST/REPLY.** Every `EngineControl` method is fire-and-forget; the reply comes back as an
   event. Each function pairs a send with a one-shot listener and a per-call deadline.
2. **ONE AT A TIME.** `set-audio-device` is answered with an `audio-devices` frame — the same type
   the devices poll waits for. On a shared connection a concurrent poll would capture the other
   request's reply and both would be wrong. Every call goes through `queue`, so exactly one is ever
   in flight.
3. **NO STALE STATE.** A fresh socket each time has none; here a dropped connection has to be
   noticed and redialled (see `connected`).

## `audioPolicy.ts` — which interface the engine should be on

The engine picks *some* device at boot and, when one is pulled out from under it, falls to whatever
the OS offers next. That is not a decision the user made. The policy that corrects it is **one
ordered list**, `audioPriority`, best first:

1. the highest-ranked interface that is actually plugged in — so replugging one is enough to get it
   back, with nothing said twice;
2. otherwise leave the engine alone, including when it is on something nobody ranked — better a
   device we did not choose than none.

### Why a list, and not a pick plus a fallback

A pick plus a fallback is a two-entry ranking with the precedence written out in prose instead of
held in the order, and it cannot express the third choice: a musician with an interface, a USB
headset and the built-in output has to leave two of the three to whichever one JUCE happens to
enumerate. A list has no arity, so the question stops existing — and a `audioDevice` /
`audioFallback` pair maps into it exactly as `[audioDevice, audioFallback]`, which is what
`settings.ts`'s `priority()` does on read.

An order also cannot express a fallback ranked above nothing with no pick at all — a state a pair
can reach and no screen can explain.

**An unranked device is never switched to.** Not the same as "an empty ranking means take the first
thing you see": a fresh machine has an empty list and the engine keeps whatever it opened. Ranking
is how the user says *this one matters*, and a list of devices the OS invented would not be one.

`reorder()` lives here too, though only the screen calls it. A move is a rule about the list — what
happens at either end, and what an unranked row becomes when it is moved — and it is tested beside
`desiredSwitch` rather than in a component. `audio.priority` carries the WHOLE order in one command
for the same reason: a reorder is one act, and two halves of it could be interleaved with a device
poll.

Kept apart from the loop that calls it so the rules are readable and testable without a running
engine. This is supervisor POLICY (which device this machine should be on), not a protocol
capability — which is why it lives here and not in `@studio/engine-client`.
