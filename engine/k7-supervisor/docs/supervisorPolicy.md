# Supervisor policy — registries, logs, processes, audio

Background for the one-line headers in `engine/k7-supervisor/src`. Each section names its file.

## `Supervisor.cpp` — the loops, and the pace each one runs at

Nothing here is pushed: the engine has no callback for an interface being unplugged or a song
being loaded, so the supervisor asks. Every poll therefore costs something forever, and the
interval is the whole of the design.

| constant | why that pace |
|---|---|
| `kWatch` (2 s) | the engine's crash watch. Fast enough that a crash is noticed before the user is, slow enough to be free — each tick is a pidfile stat or a socket connect. |
| `kDevicesPoll` (10 s) | this is what notices an interface being plugged in or pulled out — and it is the one poll that TOUCHES A DRIVER. See below. |
| `kSessionsPoll` (2 s) | an app connecting or a song loading is a human-speed event, and the submenu redraws only when the signature moves anyway. |
| `kEditPluginsPoll` (3 s) | a user swaps songs at human speed, not interface-unplug speed. |
| `kPluginsPoll` (60 s) | the plugin scan is expensive and the answer barely moves. Until it lands, and while the engine's `plugins` reply says `scanning` — the engine scans at every start, and the list it answers then is about to change — we ask at `kPluginsPollFast` (2 s) instead, to keep the spinner and the count honest; that poll reschedules itself rather than sitting on one interval. The scan's progress is not carried here: the page follows it on the engine's own socket (`engine/k7-runtime/docs/plugins.md`). |
| `kBackoffMaxS` (30 s) | the relaunch backoff for a crashing engine, doubling from 1 s. One that dies on startup — a bad audio device, a missing DLL — would otherwise be relaunched forever at one per second, and the log would be nothing but that. |
| `kDeregisterBound` (1.5 s) | a hung registry must not hold the quit open. An app gives the supervisor a few seconds in total before it kills it. |

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
falling to the next name in the order, and an app's audio menu is that far out of date. That is the
price, and it is paid on every plug.

**The real fix.** JUCE exposes an `AudioIODeviceType::Listener` that Windows feeds on hardware
arrival and removal. Moving to it would give both at once — immediate reaction AND zero periodic
scan — but it is work inside the engine, worth doing only if polling proves to be the culprit.

### Signatures, not arrays

An app redraws a menu whenever the snapshot it draws from changes, so what the polls
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

### Where the registries come from

`registry::resolve` (`Registry.cpp`) reads two tiers, the first that yields anything winning outright — they are
alternatives, not a union:

1. `registryUrls` in the settings — what the user added in the phone's studios list, or wrote in
   the config file — a deliberate choice beats an ambient one, which is why it sits above the
   environment variable;
2. `$STUDIO_REGISTRY_URL`, comma-separated for more than one.

**There is no third tier, and no default.** When neither yields anything the list is empty: the
engine heartbeats to nobody and appears in no picker. A machine is connected to a k7 instance
because someone connected it, never because the build assumed one or a backend happened to be
running — so a fresh install suggests nothing. An empty list is the normal state of a fresh machine, not a fault, which is why no app paints it
red.

**What the local backends advertise is deliberately not read.** Each writes
`<state>/web-endpoints/<service>.json` on boot (`packages/engine-registry/advertise.ts`), and
heartbeating to every URL in there would connect a dev machine to whatever happens to be running —
and, since a killed backend leaves its file behind, to things that have stopped running. Under `npm run dev` the
studio comes from `$STUDIO_REGISTRY_URL`, or from `registryUrls` in `<state>/engine-host.json`, the
file the dev engine runs from (`docs/dev.md`).

Neither tier moves while the supervisor runs, so the list is resolved at boot and on an add or a
remove, never per heartbeat.

Every URL, whichever tier it came from, is read as its family's **one registry, k7's backend's**
(`url::engineRegistryUrl` in `Url.cpp`, the twin of `engineRegistryUrl` in
`packages/web-protocol/services.ts` — `Url_test.cpp` replays that file's cases): `https://app.k7.rocks`,
`https://docs.k7.rocks` and the former hosts `https://st0.app` and `https://play.st0.app` all mean
`https://app.k7.rocks`, and any loopback URL means
`http://localhost:8789` — or k7's port in `$STUDIO_PORTS` when a host moved it, as the tray
does (`packages/web-protocol/docs/addresses.md`). The registry is mounted by k7's backend
(`packages/engine-registry/docs/shared.md`), so a supervisor that saved `https://play.st0.app` still
heartbeats the right place. The answer is a **list**, one per studio this engine is connected to, deduped.

**Plain http reaches loopback and nothing else.** A heartbeat carries the engine's token and the
tunnel secret, and the tunnel's handshake carries them again, so a registry on `http://` past
loopback would hand both to anyone on the path. `url::plaintextRefusal` is asked where they leave:
`resolve` drops such a registry with a log line, `probe` refuses to add one, every POST checks
again, and the tunnel agent does not dial it. A network where plain http is the deliberate choice —
the compose network the server's own engine reaches k7 on, `http://k7:8789` — names the host in
`$STUDIO_INSECURE_REGISTRIES` (comma-separated hostnames or `host:port`s), and
`docker/docker-compose.yml` sets it to `k7` for that container alone.

The heartbeat is **all-or-nothing**: an app shows one light, so "ok" has to mean every studio
can offer this engine. A registry that is down is simply absent from that studio's picker, which
is correct — it genuinely cannot be driven right now.

The phone's studios list draws `instances`, one row per studio FAMILY (`studioFamily`:
k7's origin, or the bare host on loopback), because to the user k7 and its registry are one
instance. `weburi.remove` therefore disconnects **the whole family**: the matching pinned registry
leaves the settings, and that registry is deregistered at once so the engine drops out of its
picker rather than aging out. A registry from `$STUDIO_REGISTRY_URL` is
marked not removable — the environment is not the supervisor's to edit. Removing the last pinned one
falls back to the ambient tiers, exactly as a fresh boot would.

`addRegistry` is an **add**, not a replace: connecting a second studio must not disconnect
the first. It takes any URL of the family and stores k7's, is idempotent beyond re-announcing,
and persists the result as the explicit list so the next boot takes it rather than the ambient
environment variable.

### An address is ASKED before it is connected

A heartbeat carries the engine's **token**, and the registry that receives it is the one the
engine's tunnel dials. So a URL that is not a studio must get neither: `https://google.com` typed
into the form must not end up pinned and beaten with the token every
five seconds.

`weburi.add` therefore asks the family's registry first — `GET /api/registry/hello`, which a registry
answers with `{ service: "k7-registry" }` (`REGISTRY_HELLO_PATH` / `REGISTRY_SERVICE` in
`packages/web-protocol/services.ts`) — and writes NOTHING unless that is the answer: no pinned
registry, no heartbeat. A redirect is refused rather than followed, so the answer comes from
the address the token would go to. While it asks, and after a refusal, the snapshot's
`instanceCheck` says so, which is how the phone's form shows *Checking…* and the reason. Under a dev
run k7's backend must therefore be up before its instance can be added.

It proves the SOFTWARE, not the owner: anyone can run a registry, and one that answers correctly
still receives the token. That is why the form says so, and why only instances the user trusts belong
there. `$STUDIO_REGISTRY_URL` is not asked — an environment variable is configuration, not a form — and
there is no other way to pin a registry: every add goes through this one.

### `weburi.pair`: a studio and the token that names its owner

`weburi.pair <origin>␟<token>` is `weburi.add` with the device token the studio minted for the
account this machine paired: asked the same way, then the token saved under the registry URL the
heartbeat looks it up by, before the list, so the first heartbeat already carries it. The pages never
send it; the tray's backend does once a pairing is stored, and the phone apps once theirs is — through
the command rather than the file, since a running supervisor saves its own settings over a file
written behind it. `weburi.remove` forgets the studio's token with it.

A token held for a studio that is not listed — the phones wrote them before this command existed — is
listed at the supervisor's first start with this version (`listPairedStudios`, `pairingsListed`), once.

### A heartbeat proves its machine

A studio may list paired machines only (`packages/engine-registry/docs/heartbeat.md`), so each
heartbeat carries `Authorization: Bearer <device token>` for THAT registry: `deviceTokens` in the
settings, by registry URL, which the phone writes when it pairs; `$STUDIO_DEVICE_TOKEN` when the
registries themselves come from the environment, never to one the user added, since a token is
one studio's and must not reach another. `$STUDIO_RENDER_KEY` rides along as
`x-studio-render-key`, which is how the server's own engine is listed.

### Shutdown order

Deregister **first**, while the entry still means something, but bounded by
`kDeregisterBound`. Then tear down — and unlike Stop, this does **not** spare an adopted
engine: one left listening holds the audio device and its port for whatever launches next.

## `Url.cpp` — an instance as the user typed it

Only ORIGINS are kept (`scheme://host[:port]`): a registry sits at a fixed path under its origin,
so a path or query pasted into the form is stripped at the door rather than stored as something
that silently cannot work. A bare host gets `https://`. A typo fails visibly rather than being
turned into some other address.

## `Log.cpp` — the merged log

The supervisor's own lines and the engine's stdout/stderr are written here to ONE file, each line
tagged with its source and a timestamp, rather than two files the user has to cross-reference. That
single file is what the web UI's Logs panel reads — the
server asks for it over the jobs channel (`readLog` in `MachineJobs.cpp`), since the file is on this
machine.

Under an app a line is **not** echoed to stderr: stderr is what the app files under its own tag, in
its own log (the merged log under `[host]` under the tray, logcat on the phone), and an echo would put every line
in two places. Run from a config file there is no app, and every line is echoed — stderr is then the
only place a terminal sees it.

The line format is `HH:MM:SS [tag] text` and must stay BYTE-IDENTICAL: the Logs panel seeds on a
tail and then polls by byte offset, so a format change is not cosmetic.

**Under an app, a start does not truncate.** This process can be relaunched mid-session after a
crash, and truncating then would wipe the log the user is reading to find out why it crashed. Run
from a config file, our own start IS the session, so we truncate at the first open.

**The supervisor bounds the file, because nothing else does.** It is the file's only writer and no
app truncates it, and a machine can stay up for months, the server's own engine first among them.
Past 8 MB (`kRotateAbove`) the file is moved to `.studio.log.1`, replacing the one there, and a
fresh one is opened: at the open, and while it runs. One generation is kept because the log is read
for the trouble of THIS run and the last; 16 MB at most is what the state folder can afford on a
phone. Where Windows refuses the move (a reader holds the file), the file is kept and the move tried
again a whole size later — never truncated in place.

**A `log` job reads a bounded slice, never the file.** The Logs panel polls it every second and a half,
so reading the whole file per poll would cost the machine its size in memory each time
(`readLog` in `MachineJobs.cpp`). With an offset, it reads from there, at most 1 MB
(`kLogReadCap`) — a reader far behind catches up over several polls. Without one, or with one past
the end — the file rotated under the reader — it reads the last megabyte and starts at its first
whole line.

## Backpressure — what a slow peer is not sent

The engine's frames reach a browser through the tunnel's socket or a WebRTC data channel, and
neither waits for a slow uplink: a frame queues inside the socket however much is already there. The
engine pushes a `state` frame twenty times a second, and an audio stream frame every 10 ms, so a
phone on a weak uplink would build a backlog that grows without bound, and a file transfer or a
command's reply would sit behind seconds of meters nobody will see.

So past 256 KB unsent toward the peer (`kDropAboveBytes` in `Backpressure.h`), those two kinds are
**dropped**, and nothing else is. They are the two the engine itself skips for a socket that is
behind (`engine/k7-runtime/server/Outbox.h`, `AudioSender.cpp`): the next `state` carries the whole
transport again, and the audio listener reads a gap in the sequence and re-cushions. A reply, a
`plugin-params-live` value, a recorder's `takes`, a job's answer and every file chunk are always sent
— none of them is superseded by the next. A jobs channel is never shed at all.

The mark sits below the uploads' own high-water (`kHighWaterBytes`, 1 MB): while a file goes up, the
meters stop rather than compete with it. A meter queued behind a megabyte is already seconds old
on the uplinks this is for, so it would show nothing true, and the transfer ends sooner.

The JSON is parsed only once the peer is already behind, so a fast link pays nothing. What was
dropped is counted and said once in `.studio.log` when the peer catches up, or every 1200 drops (a
minute of `state`) while it does not.

## `EngineProcess.cpp` — adopting, and what a pidfile is not

A pidfile is what makes a supervisor crash survivable: the engine outlives us, and the next
supervisor ADOPTS it rather than finding the port held by a process nobody owns.

A bare pid is not an identity: the OS reuses it. Trusted alone it is silent in every direction —
the engine dies, its pid goes to an unrelated process, the next supervisor adopts that process, the
crash watch never relaunches, every registry is told an engine is there — and a stop sends SIGTERM
to whatever now holds the number, or to the process GROUP that bears it.

So the pidfile (`PidFile.h`) holds the pid, the process's start time as the OS reports it and the
executable's path, and three rules follow:

- **Our own child's liveness comes from its reaper**, never from the pid: the thread that waits for
  it says when it has exited, and until then the unreaped pid cannot be anyone else's.
- **Any other pid is the engine only when the OS confirms it**: the same start time, and an
  executable named `k7-runtime`. Otherwise it is stale, and is neither adopted nor killed.
- **What cannot be confirmed is never killed.** A pidfile holding a bare pid, with no start time to confirm it, or a process the OS will not describe is adopted on its port alone and
  left running at a stop. Adopted and found to be the engine, the file is rewritten whole.

A port that answers with no pidfile naming its owner is asked of `lsof`; that owner is recorded and
adopted only when it is not some other program, and some other program is an error, never a kill.
`packages/supervisor-host` reads the same file before its own backstop kill, by the same rules.

The port is asked as well: adopt only if something is actually serving on it, and otherwise treat
the pidfile as stale, clear it and start a fresh engine.

**Why here and not in the crash watch.** The same check there would be the complete fix, and it
carries a risk this one does not: a probe that answers wrongly under load would relaunch an engine
that is playing. `engine::start` runs before anything plays, so a wrong answer costs a spare engine
instead of somebody's audio. Extending it to the crash watch is a real decision — it needs
consecutive failures before acting — and it has not been taken.

## `HostLock.cpp` — the same lesson, one file over

One supervisor per machine, in `<state>/engine-host.pid`. Asking only whether the pid is **alive**
is unrecoverable here: a supervisor crashes, Windows hands its pid to an unrelated process — this
app spawns plenty — and from then on every supervisor reads the pidfile, finds a live pid, and
refuses. For ever. The check that exists to clear a stale lock (removing it when the pid is dead)
can never fire, because the pid is not dead; it just is not a supervisor. The app runs, supervises
nothing, and says `an engine supervisor is already running (pid …)` on a loop.

`EngineProcess.cpp` solves its half by asking the **port** as well. The supervisor listens on
nothing, so there is no port to ask, and the analogue is the one `engine-registry` already uses for
`assignedSeen`: **the holder keeps saying so.** The loop rewrites the file every 2 s
(`hostlock::refresh`), and a lock nobody has refreshed for 15 s is stale whatever its pid claims. A
recycled pid costs at most fifteen seconds.

Both tests are in `HostLock_test.cpp`, and the pair is the point: a lock that is stale AND alive is
taken, a lock that is being refreshed is refused. Staleness must not become a way to steal a live
supervisor's lock — seven missed beats is the margin, and a main thread stalled that long is
pathological rather than busy.

The refresh also **reads before it writes**. A lock that has come to name somebody else was taken
from us, which is the one thing this file exists to make impossible, so it is reported rather than
silently overwritten.

Taking the lock is an **exclusive create on every attempt**, the pid written through the same handle,
and never a plain write after a stale lock was cleared: between our removing a stale file and writing
ours, another supervisor can have created its own, and a plain write would leave two holders. A file
created and not yet written is fresh and names nobody; it counts as held (`-1`), not as stale. What
remains is the window between reading a stale lock and removing it, in which another supervisor may
have replaced it — two supervisors racing past the same stale lock within microseconds.

## `EngineQueries.cpp` — request/reply over one connection

The polls run at 10 s / 2 s / 3 s, so a fresh WebSocket per call would be roughly one TCP handshake
per second, forever, each connection then reading and discarding the engine's ~20 Hz `state`
broadcasts until its own typed reply arrived. One connection whose firehose is simply not listened
to costs nothing.

Three things a fresh connection per call would give for free, and that a shared one has to provide
itself:

1. **REQUEST/REPLY.** Every engine request is fire-and-forget on the wire; the reply comes back as a
   frame of its own. Each call pairs a send with the frame type it waits for and a deadline.
2. **ONE AT A TIME.** `set-audio-device` is answered with an `audio-devices` frame — the same type
   the devices poll waits for. On a shared connection a concurrent poll would capture the other
   request's reply and both would be wrong. Every call goes through the worker's queue, so exactly
   one is ever in flight.
3. **NO STALE STATE.** A fresh socket each time has none; here a dropped connection has to be
   noticed and redialled — a deadline that passes drops it, and the next call dials again.

## `AudioPolicy.cpp` — which interface the engine should be on

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
`Settings.cpp` does on read.

An order also cannot express a fallback ranked above nothing with no pick at all — a state a pair
can reach and no screen can explain.

**An unranked device is never switched to.** Not the same as "an empty ranking means take the first
thing you see": a fresh machine has an empty list and the engine keeps whatever it opened. Ranking
is how the user says *this one matters*, and a list of devices the OS invented would not be one.

`audio.priority` carries the WHOLE order in one command: a reorder is one act, and two halves of it
could be interleaved with a device poll.

Kept apart from the loop that calls it so the rules are readable and testable without a running
engine. This is supervisor POLICY (which device this machine should be on), not a protocol
capability — which is why it lives here and not in the engine.
